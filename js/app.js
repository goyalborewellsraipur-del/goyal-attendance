(function(){
  const STORE_KEY = 'nexgen_sheet_auth_site_data_v3';
  const ENQUIRY_KEY = 'nexgen_sheet_enquiries_v2';
  const AUTH_KEY = 'nexgen_supabase_user_cache';
  let authUser = null;
  let supabaseClient = null;
  let remoteEnquiryCache = null; // local display cache only; Google Sheet is main enquiry storage

  const app = document.getElementById('app');
  let state = loadData();

  function supabaseConfig(){ return window.NEXGEN_SUPABASE || {}; }
  function hasSupabaseConfig(){
    const cfg = supabaseConfig();
    return !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && !String(cfg.SUPABASE_URL).includes('PASTE_') && !String(cfg.SUPABASE_ANON_KEY).includes('PASTE_'));
  }
  function getSupabase(){
    if(!hasSupabaseConfig() || !window.supabase) return null;
    if(!supabaseClient){
      const cfg = supabaseConfig();
      supabaseClient = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      });
    }
    return supabaseClient;
  }

  function clone(v){ return JSON.parse(JSON.stringify(v)); }
  function loadData(){
    try{
      const saved = localStorage.getItem(STORE_KEY);
      if(!saved) return clone(SITE_DATA);
      const parsed = JSON.parse(saved);
      return deepMerge(clone(SITE_DATA), parsed);
    }catch(e){ return clone(SITE_DATA); }
  }
  function deepMerge(base, patch){
    Object.keys(patch || {}).forEach(k => {
      if(patch[k] && typeof patch[k] === 'object' && !Array.isArray(patch[k]) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) base[k] = deepMerge(base[k], patch[k]);
      else base[k] = patch[k];
    });
    return base;
  }
  function saveData(){ localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
  async function loadRemoteSiteData(){
    // Supabase login stays as authentication only. Product image overrides are loaded from Supabase Storage mapping table.
    await loadProductImageOverrides();
  }
  async function saveRemoteSiteData(){
    saveData();
  }
  async function loadProductImageOverrides(){
    const sb = getSupabase();
    if(!sb) return;
    try{
      const { data, error } = await sb
        .from('product_image_overrides')
        .select('product_id,image_url,image_path,updated_at');
      if(error || !Array.isArray(data)) return;
      const overrides = {};
      data.forEach(row => { if(row.product_id && row.image_url) overrides[row.product_id] = row; });
      state.products = state.products.map(p => {
        const row = overrides[p.id];
        if(!row) return p;
        return { ...p, image: row.image_url, remoteImageUrl: row.image_url, remoteImagePath: row.image_path || '' };
      });
    }catch(e){
      console.warn('Product image overrides not loaded', e);
    }
  }
  function safeFileName(name){
    return String(name || 'product-image.jpg')
      .toLowerCase()
      .replace(/[^a-z0-9.]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'product-image.jpg';
  }
  async function uploadProductImage(index, file){
    const sb = getSupabase();
    if(!sb) throw new Error('Supabase config missing.');
    if(!isAdmin()) throw new Error('Admin login required.');
    const product = state.products[index];
    if(!product) throw new Error('Product not found.');
    if(!file) throw new Error('Please select an image first.');
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)) throw new Error('Only JPG, PNG or WEBP image allowed.');
    if(file.size > 5 * 1024 * 1024) throw new Error('Image size must be under 5 MB.');

    const path = `${product.id}/${Date.now()}-${safeFileName(file.name)}`;
    const { error: uploadError } = await sb.storage
      .from('product-images')
      .upload(path, file, { cacheControl: '3600', upsert: true, contentType: file.type });
    if(uploadError) throw uploadError;

    const { data: publicData } = sb.storage.from('product-images').getPublicUrl(path);
    const publicUrl = publicData && publicData.publicUrl;
    if(!publicUrl) throw new Error('Public URL not generated.');

    const { error: dbError } = await sb.from('product_image_overrides').upsert({
      product_id: product.id,
      image_url: publicUrl,
      image_path: path,
      updated_by: currentUser()?.id || null,
      updated_at: new Date().toISOString()
    }, { onConflict: 'product_id' });
    if(dbError) throw dbError;

    state.products[index].image = publicUrl;
    state.products[index].remoteImageUrl = publicUrl;
    state.products[index].remoteImagePath = path;
    saveData();
    return publicUrl;
  }
  function enquiries(){ try{return JSON.parse(localStorage.getItem(ENQUIRY_KEY) || '[]')}catch(e){return []} }
  function saveEnquiries(list){ localStorage.setItem(ENQUIRY_KEY, JSON.stringify(list)); }
  function esc(v){ return String(v ?? '').replace(/[&<>'"]/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[s])); }
  function cleanPhone(){ return String(state.company.phone || '').replace(/\D/g,''); }
  function phoneHref(){ return 'tel:+91' + cleanPhone(); }
  function mailHref(subject='NEXGEN Enquiry', body='Hello NEXGEN CORPORATION, I want a quotation.'){ return 'mailto:' + (state.integrations?.emailTo || state.company.email || '') + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body); }
  function whatsappHref(message){ return 'https://wa.me/91' + cleanPhone() + '?text=' + encodeURIComponent(message || state.company.whatsappMessage || 'Hello'); }
  function mapHref(){ return state.company.mapLink || 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(state.company.address || ''); }
  function webHref(){ const w = state.company.website || state.company.domain || ''; return w.startsWith('http') ? w : 'https://' + w; }
  function icon(name, cls='icon-sm'){ return `<img class="${cls}" src="assets/icons/${name}.svg" alt="${name}">`; }
  function route(){ return location.hash.replace('#','') || 'home'; }
  function go(r){ location.hash = r; }
  function currentUser(){ return authUser; }
  function setUser(u){
    authUser = u;
    if(u) sessionStorage.setItem(AUTH_KEY, JSON.stringify(u));
    else sessionStorage.removeItem(AUTH_KEY);
  }
  async function refreshAuthUser(){
    const sb = getSupabase();
    if(!sb){ setUser(null); return null; }
    try{
      const { data, error } = await sb.auth.getUser();
      if(error || !data?.user){ setUser(null); return null; }
      const user = data.user;
      let role = 'Staff';
      let name = user.user_metadata?.full_name || user.email || 'User';
      try{
        const { data: profile } = await sb.from('profiles').select('role, full_name, email').eq('id', user.id).maybeSingle();
        if(profile){
          role = profile.role || role;
          name = profile.full_name || profile.email || name;
        }
      }catch(e){}
      const adminEmails = (supabaseConfig().ADMIN_EMAILS || []).map(x => String(x).toLowerCase().trim());
      if(user.email && adminEmails.includes(user.email.toLowerCase())) role = 'Admin';
      const normalized = { id:user.id, email:user.email, username:user.email, role, name };
      setUser(normalized);
      return normalized;
    }catch(e){ setUser(null); return null; }
  }
  async function logout(){
    const sb = getSupabase();
    if(sb){ try{ await sb.auth.signOut(); }catch(e){} }
    setUser(null);
  }
  function isAdmin(){ const u = currentUser(); return !!(u && u.role === 'Admin'); }
  function category(id){ return state.categories.find(c => c.id === id); }
  function productsByCategory(id){ return state.products.filter(p => p.categoryId === id); }
  function toast(msg){
    let t = document.getElementById('toast');
    if(!t){ t = document.createElement('div'); t.id='toast'; t.className='toast'; document.body.appendChild(t); }
    t.textContent = msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),2200);
  }
  function setDocumentMeta(title, desc){
    document.title = title || state.seo?.title || state.company.name;
    const meta = document.querySelector('meta[name="description"]');
    if(meta) meta.setAttribute('content', desc || state.seo?.description || '');
  }

  function shell(content){ return topBar()+header()+content+footer()+floatingButtons()+quoteModal()+drawer()+`<div id="toast" class="toast"></div>`; }

  function topBar(){ return `<div class="top"><div class="container">
    <div>${esc(state.company.tagline)}</div>
    <div class="top-links">
      <a class="top-link" href="${phoneHref()}">${icon('phone')} +91 ${esc(state.company.phone)}</a>
      <a class="top-link" href="${whatsappHref()}" target="_blank" rel="noopener">${icon('whatsapp')} WhatsApp</a>
      <a class="top-link" href="${mailHref()}">${esc(state.company.email)}</a>
    </div>
  </div></div>`; }

  function header(){ return `<header class="header"><div class="container nav">
    <a class="brand" href="#home" aria-label="NEXGEN CORPORATION Home">
      <img class="logo" src="${esc(state.company.logo)}" alt="${esc(state.company.name)}">
    </a>
    <nav class="nav-links">
      <a href="#home">Home</a>
      <a href="#products">Products</a>
      <a href="#about">About</a>
      <a href="#catalogue">Catalogue</a>
      <a href="#contact">Contact</a>
      <a href="#login">Authorized Login</a>
    </nav>
    <div class="nav-action">
      <a class="btn btn-light" href="docs/Nexgen-Construction-Equipment-Catalogue.pdf" download>PDF</a>
    </div>
    <button class="menu" id="menuBtn" aria-label="Menu">☰</button>
  </div></header>`; }

  function footer(){ return `<footer class="footer"><div class="container">
    <div><img class="footer-logo" src="${esc(state.company.logo)}" alt="${esc(state.company.name)}"><p>${esc(state.company.tagline)}</p><p>${esc(state.company.subTagline)}</p></div>
    <div><h3>Company</h3><div class="footer-links"><a href="#about">About</a><a href="#products">Products</a><a href="#catalogue">Catalogue</a><a href="#contact">Contact</a><a href="#login">Authorized Login</a></div></div>
    <div><h3>Products</h3><div class="footer-links">${state.categories.slice(0,6).map(c=>`<a href="#category/${esc(c.id)}">${esc(c.title)}</a>`).join('')}</div></div>
    <div><h3>Contact</h3><p>+91 ${esc(state.company.phone)}</p><p>${esc(state.company.email)}</p><p>${esc(state.company.address)}</p><p><a href="${webHref()}" target="_blank" rel="noopener">${esc(state.company.website || '')}</a></p></div>
  </div><div class="copy">© ${new Date().getFullYear()} ${esc(state.company.name)}</div></footer>`; }

  function floatingButtons(){ return `<div class="float">
    <a class="float-wa" href="${whatsappHref()}" target="_blank" rel="noopener" aria-label="WhatsApp">${icon('whatsapp','')}</a>
    <a class="float-call" href="${phoneHref()}" aria-label="Phone">${icon('phone','')}</a>
    <button class="float-admin" id="adminButton" aria-label="Admin">⚙</button>
  </div>`; }

  function drawer(){ return `<div class="drawer" id="drawer"><div class="drawer-panel">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px"><b>Menu</b><button id="closeDrawer" style="width:44px;height:44px;border-radius:14px;background:#f1f5f9;font-size:26px">×</button></div>
    <a href="#home">Home</a><a href="#products">Products</a><a href="#about">About</a><a href="#catalogue">Catalogue</a><a href="#contact">Contact</a><a href="#login">Authorized Login</a>
    <div style="height:1px;background:#e5e7eb;margin:12px 0"></div>
    <a class="btn btn-gold" href="${whatsappHref()}" target="_blank" rel="noopener">${icon('whatsapp')} WhatsApp</a>
    <a class="btn btn-dark" href="${phoneHref()}">${icon('phone')} Call</a>
  </div></div>`; }

  function home(){
    setDocumentMeta(state.seo.title, state.seo.description);
    return shell(`
    <section class="hero"><div class="container">
      <div>
        <span class="eyebrow">${esc(state.company.tagline)}</span>
        <h1><span class="gold">${esc(state.company.name)}</span><br>${esc(state.hero.title)}</h1>
        <p>${esc(state.hero.text)}</p>
        <div class="hero-buttons">
          <button class="btn btn-gold" data-quote="General Enquiry">${esc(state.hero.button1)}</button>
          <a class="btn btn-light" href="#products">${esc(state.hero.button2)}</a>
          <a class="btn btn-dark" href="${phoneHref()}">${icon('phone')} Call</a>
        </div>
        <div class="stats">
          <div class="stat"><b>${state.categories.length}</b><span>Categories</span></div>
          <div class="stat"><b>${state.products.length}+</b><span>Products</span></div>
          <div class="stat"><b>${esc(state.company.established || '2026')}</b><span>Established</span></div>
        </div>
      </div>
      <div><div class="hero-logo-box"><img src="${esc(state.company.logo)}" alt="${esc(state.company.name)}"></div></div>
    </div></section>

    <section class="section soft"><div class="container">
      <div class="section-head"><div><div class="kicker">Services</div><h2 class="title">Products and Services</h2></div></div>
      <div class="grid grid-3">${state.services.map(s=>`<div class="card card-pad service-card"><div class="service-icon">N</div><b>${esc(s)}</b></div>`).join('')}</div>
    </div></section>

    <section class="section"><div class="container">
      <div class="section-head"><div><div class="kicker">Categories</div><h2 class="title">Product Range</h2></div><a class="btn btn-dark" href="#products">All Products</a></div>
      <div class="grid grid-4">${state.categories.map(categoryCard).join('')}</div>
    </div></section>

    <section class="section black"><div class="container about-grid">
      <div><div class="kicker">About</div><h2 class="title">${esc(state.about.title)}</h2><p class="lead">${esc(state.about.text)}</p><div class="hero-buttons"><a class="btn btn-gold" href="#contact">Contact</a><a class="btn btn-light" href="docs/Nexgen-Construction-Equipment-Catalogue.pdf" download>Download PDF</a></div></div>
      <div class="grid grid-2">${state.about.points.map(p=>`<div class="point"><span class="tick">✓</span>${esc(p)}</div>`).join('')}</div>
    </div></section>

    <section class="section soft"><div class="container">
      <div class="section-head"><div><div class="kicker">Products</div><h2 class="title">Featured Products</h2></div></div>
      <div class="grid grid-4">${state.products.slice(0,12).map(productCard).join('')}</div>
    </div></section>
    `);
  }

  function categoryCard(c){ return `<article class="category-card">
    <img loading="lazy" src="${esc(c.image)}" alt="${esc(c.title)}">
    <div class="body"><h3>${esc(c.title)}</h3><p>${esc(c.subtitle)}</p><div class="small-row"><span>${productsByCategory(c.id).length} Products</span><a href="#category/${esc(c.id)}">View</a></div></div>
  </article>`; }

  function productCard(p){ return `<article class="product-card card">
    <img loading="lazy" src="${esc(p.image)}" alt="${esc(p.name)}">
    <div class="product-body"><span class="tag">${esc(p.category)}</span><h3>${esc(p.name)}</h3><p>${esc(p.description)}</p><div class="product-actions"><button class="btn btn-light" data-detail="${esc(p.id)}">Details</button><button class="btn btn-gold" data-quote="${esc(p.name)}">Quote</button></div></div>
  </article>`; }

  function products(){
    setDocumentMeta('Products | '+state.company.name, 'Browse NEXGEN product catalogue.');
    return shell(`<section class="section soft"><div class="container">
      <div class="section-head"><div><div class="kicker">Products</div><h2 class="title">Product Catalogue</h2></div></div>
      <div class="search-box"><input id="searchInput" class="input" placeholder="Search product"><select id="categorySelect" class="select"><option value="all">All Categories</option>${state.categories.map(c=>`<option value="${esc(c.id)}">${esc(c.title)}</option>`).join('')}</select><button id="searchBtn" class="btn btn-dark">Search</button></div>
      <div id="productResult" class="grid grid-4">${state.products.slice(0,120).map(productCard).join('')}</div>
      <p id="productCount" class="lead">Showing ${Math.min(120,state.products.length)} of ${state.products.length}</p>
    </div></section>`);
  }

  function categoryPage(id){
    const cat = category(id); if(!cat) return products();
    const list = productsByCategory(id);
    setDocumentMeta(cat.title+' | '+state.company.name, cat.subtitle);
    return shell(`<section class="section soft"><div class="container about-grid">
      <div><div class="kicker">Category</div><h2 class="title">${esc(cat.title)}</h2><p class="lead">${esc(cat.subtitle)}</p><div class="hero-buttons"><button class="btn btn-gold" data-quote="${esc(cat.title)}">Quote</button><a class="btn btn-dark" href="#products">All Products</a></div></div>
      <div class="catalogue-card"><img loading="lazy" src="${esc(cat.image)}" alt="${esc(cat.title)}"></div>
    </div></section><section class="section"><div class="container"><div class="grid grid-4">${list.map(productCard).join('')}</div></div></section>`);
  }

  function about(){
    setDocumentMeta('About | '+state.company.name, state.about.text);
    return shell(`<section class="section soft"><div class="container about-grid">
      <div><div class="kicker">About</div><h2 class="title">${esc(state.company.name)}</h2><p class="lead">${esc(state.about.text)}</p></div>
      <div class="grid grid-2">${state.about.points.map(p=>`<div class="point"><span class="tick">✓</span>${esc(p)}</div>`).join('')}</div>
    </div></section>
    <section class="section"><div class="container"><div class="section-head"><div><div class="kicker">Services</div><h2 class="title">What We Supply</h2></div></div><div class="grid grid-3">${state.services.map(s=>`<div class="card card-pad"><h3>${esc(s)}</h3></div>`).join('')}</div></div></section>`);
  }

  function catalogue(){
    setDocumentMeta('Catalogue | '+state.company.name, 'Download and view NEXGEN construction equipment catalogue.');
    return shell(`<section class="section soft"><div class="container">
      <div class="section-head"><div><div class="kicker">Catalogue</div><h2 class="title">NEXGEN Catalogue</h2></div><a class="btn btn-dark" href="docs/Nexgen-Construction-Equipment-Catalogue.pdf" download>Download PDF</a></div>
      <div class="catalogue-grid">${state.cataloguePages.map((src,i)=>`<div class="catalogue-card"><div class="catalogue-title">Page ${i+1}</div><img loading="lazy" src="${esc(src)}" alt="Catalogue Page ${i+1}"></div>`).join('')}</div>
    </div></section>`);
  }

  function contact(){
    setDocumentMeta('Contact | '+state.company.name, 'Contact NEXGEN CORPORATION.');
    return shell(`<section class="section soft"><div class="container contact-grid">
      <div>
        <div class="kicker">Contact</div><h2 class="title">Get in Touch</h2>
        <div class="grid" style="margin-top:20px">
          <div class="contact-line">${icon('phone')}<div><b>Phone</b><br><a href="${phoneHref()}">+91 ${esc(state.company.phone)}</a></div></div>
          <div class="contact-line">${icon('whatsapp')}<div><b>WhatsApp</b><br><a href="${whatsappHref()}" target="_blank" rel="noopener">+91 ${esc(state.company.phone)}</a></div></div>
          <div class="contact-line"><div style="font-weight:900;width:24px">@</div><div><b>Email</b><br><a href="${mailHref()}">${esc(state.company.email)}</a></div></div>
          <div class="contact-line"><div style="font-weight:900;width:24px">🌐</div><div><b>Website</b><br><a href="${webHref()}" target="_blank" rel="noopener">${esc(state.company.website || state.company.domain || '')}</a></div></div>
          <div class="contact-line"><div style="font-weight:900;width:24px">📍</div><div><b>Address</b><br>${esc(state.company.address)}<br><br><a class="btn btn-gold" href="${mapHref()}" target="_blank" rel="noopener">Get Directions</a></div></div>
        </div>
      </div>
      <div class="card card-pad"><h2 style="margin-top:0">Send Enquiry</h2>${enquiryForm('General Enquiry')}</div>
    </div></section>`);
  }

  function enquiryForm(product){ return `<form class="form enquiry-form">
    <input type="hidden" name="product" value="${esc(product)}">
    <label class="label">Name<input class="input" name="name" required></label>
    <label class="label">Phone<input class="input" name="phone" required></label>
    <label class="label">Email<input class="input" name="email"></label>
    <label class="label">Requirement<textarea class="textarea" name="message" rows="4">${esc(product)}</textarea></label>
    <button class="btn btn-gold" type="submit">Submit Enquiry</button>
    <a class="btn btn-dark" href="${whatsappHref('Hello NEXGEN CORPORATION, I want a quotation for ' + product)}" target="_blank" rel="noopener">${icon('whatsapp')} WhatsApp</a>
    <a class="btn btn-light" href="${mailHref('NEXGEN Enquiry - '+product, 'Hello NEXGEN CORPORATION, I want a quotation for '+product)}">Email</a>
  </form>`; }

  function quoteModal(){ return `<div class="modal" id="quoteModal"><div class="modal-box"><div class="modal-head"><div><div class="kicker">Quote</div><h2 id="modalTitle" style="margin:4px 0 0">Get Quote</h2></div><button class="close" id="closeModal">×</button></div><div class="modal-body" id="modalBody"></div></div></div>`; }
  function productDetail(id){
    const p = state.products.find(x => x.id === id); if(!p) return;
    document.getElementById('modalTitle').textContent = p.name;
    document.getElementById('modalBody').innerHTML = `<div class="about-grid"><img loading="lazy" src="${esc(p.image)}" alt="${esc(p.name)}" style="border-radius:18px"><div><p><b>Category:</b> ${esc(p.category)}</p><p>${esc(p.description)}</p><button class="btn btn-gold" data-quote="${esc(p.name)}">Quote</button></div></div>`;
    document.getElementById('quoteModal').classList.add('show');
    document.querySelectorAll('[data-quote]').forEach(b => b.addEventListener('click', () => openQuote(b.dataset.quote)));
  }
  function openQuote(product){ document.getElementById('modalTitle').textContent = 'Get Quote'; document.getElementById('modalBody').innerHTML = enquiryForm(product); document.getElementById('quoteModal').classList.add('show'); bindForms(); }
  function closeModal(){ document.getElementById('quoteModal')?.classList.remove('show'); }

  function filterProducts(){
    const q = (document.getElementById('searchInput')?.value || '').toLowerCase().trim();
    const c = document.getElementById('categorySelect')?.value || 'all';
    const result = state.products.filter(p => (`${p.name} ${p.category} ${p.description}`.toLowerCase().includes(q)) && (c === 'all' || p.categoryId === c));
    document.getElementById('productResult').innerHTML = result.slice(0,180).map(productCard).join('') || '<div class="card card-pad">No product found.</div>';
    document.getElementById('productCount').textContent = 'Showing ' + Math.min(180,result.length) + ' of ' + result.length;
    bindProductButtons();
  }

  function bindPublic(){
    bindProductButtons();
    document.getElementById('closeModal')?.addEventListener('click', closeModal);
    document.getElementById('quoteModal')?.addEventListener('click', e => { if(e.target.id === 'quoteModal') closeModal(); });
    document.getElementById('searchBtn')?.addEventListener('click', filterProducts);
    document.getElementById('searchInput')?.addEventListener('input', filterProducts);
    document.getElementById('categorySelect')?.addEventListener('change', filterProducts);
    document.getElementById('adminButton')?.addEventListener('click', () => go('admin'));
    document.getElementById('menuBtn')?.addEventListener('click', () => document.getElementById('drawer')?.classList.add('show'));
    document.getElementById('closeDrawer')?.addEventListener('click', () => document.getElementById('drawer')?.classList.remove('show'));
    document.getElementById('drawer')?.addEventListener('click', e => { if(e.target.id === 'drawer') e.currentTarget.classList.remove('show'); });
    bindForms();
  }
  function bindProductButtons(){ document.querySelectorAll('[data-quote]').forEach(b => b.addEventListener('click', () => openQuote(b.dataset.quote))); document.querySelectorAll('[data-detail]').forEach(b => b.addEventListener('click', () => productDetail(b.dataset.detail))); }

  function bindForms(){
    document.querySelectorAll('.enquiry-form').forEach(form => {
      if(form.dataset.bound) return; form.dataset.bound = '1';
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const fd = new FormData(form);
        const item = { date:new Date().toLocaleString(), product:fd.get('product'), name:fd.get('name'), phone:fd.get('phone'), email:fd.get('email'), message:fd.get('message') };
        const list = enquiries(); list.unshift(item); saveEnquiries(list);
        await sendIntegrations(item);
        closeModal(); toast('Enquiry submitted'); form.reset();
        if(state.integrations?.redirectToWhatsapp){ window.open(whatsappHref(formatLeadMessage(item)), '_blank'); }
      });
    });
  }
  function formatLeadMessage(e){ return `Hello NEXGEN CORPORATION, I want a quotation.\nProduct: ${e.product}\nName: ${e.name}\nPhone: ${e.phone}\nEmail: ${e.email || ''}\nRequirement: ${e.message || ''}`; }
  async function sendIntegrations(item){
    const payload = JSON.stringify({
      date: item.date || new Date().toLocaleString(),
      product: item.product || '',
      name: item.name || '',
      phone: item.phone || '',
      email: item.email || '',
      message: item.message || '',
      source: 'website'
    });
    const tasks = [];
    if(state.integrations?.googleSheetUrl){
      tasks.push(fetch(state.integrations.googleSheetUrl, {
        method:'POST',
        mode:'no-cors',
        headers:{'Content-Type':'text/plain;charset=utf-8'},
        body:payload
      }).catch(()=>null));
    }
    if(state.integrations?.formspreeUrl){
      tasks.push(fetch(state.integrations.formspreeUrl, {method:'POST', headers:{'Content-Type':'application/json'}, body:payload}).catch(()=>null));
    }
    if(tasks.length) await Promise.all(tasks);
  }

  function login(target='dashboard'){
    const active = currentUser();
    const configReady = hasSupabaseConfig() && !!getSupabase();
    app.innerHTML = `<div class="login-page"><div class="login-card"><img src="${esc(state.company.logo)}" alt="logo"><h1>Authorized Login</h1>${active ? `<div class="login-status"><b>${esc(active.name)}</b><span>${esc(active.role)}</span></div>` : ''}${!configReady ? `<div class="login-status"><b>Supabase not connected</b><span>Update js/supabase-config.js</span></div>` : ''}<label class="label">Email<input id="authEmail" class="input" type="email" autocomplete="username" placeholder="admin@example.com"></label><label class="label">Password<input id="authPass" class="input" type="password" autocomplete="current-password"></label><button id="authLogin" class="btn btn-gold" style="width:100%;margin-top:14px">Login</button><button id="resetPass" class="btn btn-light" style="width:100%;margin-top:10px">Reset Password</button><button id="backHome" class="btn btn-light" style="width:100%;margin-top:10px">Back</button><p id="loginError" style="color:#be123c;font-weight:800"></p><p style="color:#64748b;font-size:13px;line-height:1.6;margin-bottom:0">Use Supabase Authentication users. Admin access is allowed from the profiles table role or ADMIN_EMAILS in supabase-config.js.</p></div></div>`;
    document.getElementById('backHome').onclick = () => go('home');
    document.getElementById('authLogin').onclick = async () => {
      const errBox = document.getElementById('loginError');
      errBox.textContent = '';
      const sb = getSupabase();
      if(!sb){ errBox.textContent = 'Supabase config missing. Update js/supabase-config.js first.'; return; }
      const email = document.getElementById('authEmail').value.trim().toLowerCase();
      const password = document.getElementById('authPass').value;
      if(!email || !password){ errBox.textContent = 'Email and password required'; return; }
      const btn = document.getElementById('authLogin');
      btn.textContent = 'Please wait...'; btn.disabled = true;
      const { error } = await sb.auth.signInWithPassword({ email, password });
      btn.textContent = 'Login'; btn.disabled = false;
      if(error){ errBox.textContent = error.message || 'Login failed'; return; }
      const user = await refreshAuthUser();
      if(!user){ errBox.textContent = 'Login failed'; return; }
      go(user.role === 'Admin' || target === 'admin' ? 'admin' : 'dashboard');
    };
    document.getElementById('resetPass').onclick = async () => {
      const errBox = document.getElementById('loginError');
      const sb = getSupabase();
      const email = document.getElementById('authEmail').value.trim().toLowerCase();
      if(!sb){ errBox.textContent = 'Supabase config missing.'; return; }
      if(!email){ errBox.textContent = 'Enter your email first.'; return; }
      const redirectTo = location.origin + location.pathname + '#login';
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo });
      errBox.textContent = error ? error.message : 'Password reset email sent';
    };
  }
  function dashboard(){
    const u = currentUser(); if(!u) return login('dashboard');
    app.innerHTML = `<div class="admin-page"><header class="admin-header"><div class="container"><b>Authorized Dashboard</b><div><button class="btn btn-light" id="dashHome">View Site</button><button class="btn btn-red" id="dashLogout">Logout</button></div></div></header><div class="container" style="padding:28px 0"><div class="admin-main"><h2>Welcome, ${esc(u.name)}</h2><p class="lead">Role: ${esc(u.role)}</p><div class="grid grid-3" style="margin-top:18px"><a class="card card-pad" href="#products"><b>Products</b><p>View catalogue</p></a><a class="card card-pad" href="#catalogue"><b>Catalogue</b><p>Download PDF</p></a><a class="card card-pad" href="${whatsappHref('Hello NEXGEN CORPORATION, I am an authorized user.')}" target="_blank"><b>WhatsApp</b><p>Contact support</p></a>${u.role === 'Admin' ? `<a class="card card-pad" href="#admin"><b>Admin Panel</b><p>Manage website</p></a>` : ''}</div></div></div></div>`;
    document.getElementById('dashHome').onclick = () => go('home');
    document.getElementById('dashLogout').onclick = async () => { await logout(); go('home'); };
  }

  function renderAdmin(tab='company'){
    if(!isAdmin()) return login('admin');
    app.innerHTML = `<div class="admin-page"><header class="admin-header"><div class="container"><b>Admin Panel</b><div><button class="btn btn-light" id="viewSite">View Site</button><button class="btn btn-light" id="viewDashboard">Dashboard</button><button class="btn btn-dark" id="saveAdmin">Save</button><button class="btn btn-red" id="logoutAdmin">Logout</button></div></div></header><div class="container admin-layout"><aside class="admin-menu"><button data-tab="company">Company</button><button data-tab="products">Products</button><button data-tab="categories">Categories</button><button data-tab="catalogue">Catalogue</button><button data-tab="enquiries">Enquiries</button><button data-tab="seo">SEO & Google Sheet</button><button data-tab="access">Access</button></aside><main class="admin-main" id="adminMain"></main></div></div>`;
    document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => adminContent(b.dataset.tab));
    document.getElementById('saveAdmin').onclick = async () => { await saveRemoteSiteData(); toast('Saved in this browser'); };
    document.getElementById('viewSite').onclick = () => go('home');
    document.getElementById('viewDashboard').onclick = () => go('dashboard');
    document.getElementById('logoutAdmin').onclick = async () => { await logout(); go('home'); };
    adminContent(tab);
  }
  function adminContent(tab){
    document.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    const main = document.getElementById('adminMain');
    if(tab === 'company') main.innerHTML = adminCompany();
    if(tab === 'products') main.innerHTML = adminProducts();
    if(tab === 'categories') main.innerHTML = adminCategories();
    if(tab === 'catalogue') main.innerHTML = adminCatalogue();
    if(tab === 'enquiries') main.innerHTML = adminEnquiries();
    if(tab === 'seo') main.innerHTML = adminSeo();
    if(tab === 'access') main.innerHTML = adminAccess();
    bindAdmin(tab);
    if(tab === 'enquiries' && !remoteEnquiryCache) loadRemoteEnquiries(true);
  }
  function input(path,label,value){ return `<label class="label">${esc(label)}<input class="input admin-input" data-path="${esc(path)}" value="${esc(value)}"></label>`; }
  function textarea(path,label,value,rows=4){ return `<label class="label">${esc(label)}<textarea class="textarea admin-input" rows="${rows}" data-path="${esc(path)}">${esc(value)}</textarea></label>`; }
  function adminCompany(){ const c=state.company,h=state.hero,a=state.about; return `<h2>Company</h2><div class="admin-row">${input('company.name','Name',c.name)}${input('company.tagline','Tagline',c.tagline)}${input('company.subTagline','Sub Tagline',c.subTagline)}${input('company.phone','Phone',c.phone)}${input('company.secondaryPhone','Secondary Phone',c.secondaryPhone)}${input('company.email','Email',c.email)}${input('company.website','Website',c.website)}${input('company.domain','Domain',c.domain)}${input('company.address','Address',c.address)}${input('company.mapLink','Google Map Link',c.mapLink)}${input('company.logo','Logo Path',c.logo)}${input('company.established','Established',c.established)}${input('hero.title','Home Title',h.title)}${textarea('hero.text','Home Text',h.text)}${input('hero.button1','Button 1',h.button1)}${input('hero.button2','Button 2',h.button2)}${textarea('about.text','About Text',a.text,6)}${textarea('about.points','About Points',a.points.join('\n'),6)}</div>`; }
  function adminProducts(){ return `<div style="display:flex;justify-content:space-between;align-items:center;gap:12px"><h2>Products</h2><button class="btn btn-gold" id="addProduct">Add Product</button></div><p class="lead">Use Change Image to upload a product image permanently in Supabase Storage. It will stay after refresh and on all devices.</p><div class="admin-list">${state.products.map((p,i)=>`<div class="admin-item"><div style="display:flex;justify-content:space-between;gap:10px"><b>${esc(p.name)}</b><button class="btn btn-red" data-delete-product="${i}">Delete</button></div><div class="admin-product-edit"><div><img class="admin-product-thumb" src="${esc(p.image)}" alt="${esc(p.name)}"><label class="label">Change Image<input class="input product-image-file" type="file" accept="image/jpeg,image/png,image/webp" data-product-file="${i}"></label><button class="btn btn-gold" data-upload-product-image="${i}" style="margin-top:10px;width:100%">Upload & Save Image</button>${p.remoteImageUrl ? `<div class="remote-badge">Saved in Supabase</div>` : `<div class="remote-badge muted">Static image</div>`}</div><div class="admin-product-grid">${input(`products.${i}.name`,'Name',p.name)}<label class="label">Category<select class="select admin-input" data-path="products.${i}.categoryId">${state.categories.map(c=>`<option value="${esc(c.id)}" ${p.categoryId===c.id?'selected':''}>${esc(c.title)}</option>`).join('')}</select></label>${input(`products.${i}.price`,'Price',p.price)}${input(`products.${i}.image`,'Image URL / Path',p.image)}${textarea(`products.${i}.description`,'Description',p.description)}</div></div></div>`).join('')}</div>`; }
  function adminCategories(){ return `<div style="display:flex;justify-content:space-between;align-items:center;gap:12px"><h2>Categories</h2><button class="btn btn-gold" id="addCategory">Add Category</button></div><div class="admin-list">${state.categories.map((c,i)=>`<div class="admin-item"><div style="display:flex;justify-content:space-between;gap:10px"><b>${esc(c.title)}</b><button class="btn btn-red" data-delete-category="${i}">Delete</button></div><div class="admin-product-grid" style="margin-top:12px">${input(`categories.${i}.title`,'Title',c.title)}${input(`categories.${i}.subtitle`,'Subtitle',c.subtitle)}${input(`categories.${i}.image`,'Image',c.image)}${input(`categories.${i}.pdfPage`,'Page',c.pdfPage)}</div></div>`).join('')}</div>`; }
  function adminCatalogue(){ return `<h2>Catalogue Pages</h2><div class="catalogue-grid">${state.cataloguePages.map((src,i)=>`<div class="catalogue-card"><div class="catalogue-title">Page ${i+1}</div><img loading="lazy" src="${esc(src)}" alt="Page ${i+1}"></div>`).join('')}</div>`; }
  function adminEnquiries(){ const list=enquiries(); return `<div style="display:flex;justify-content:space-between;align-items:center;gap:12px"><h2>Enquiries</h2><div><button class="btn btn-light" id="refreshEnquiries">Refresh</button><button class="btn btn-light" id="downloadCsv">CSV</button><button class="btn btn-red" id="clearEnquiries">Clear</button></div></div><p class="lead">Main enquiry data will go to Google Sheet. This table shows only the local copy saved in this browser.</p><div style="overflow:auto"><table class="table"><thead><tr><th>Date</th><th>Name</th><th>Phone</th><th>Email</th><th>Product</th><th>Message</th></tr></thead><tbody>${list.map(e=>`<tr><td>${esc(e.date || '')}</td><td>${esc(e.name)}</td><td>${esc(e.phone)}</td><td>${esc(e.email)}</td><td>${esc(e.product)}</td><td>${esc(e.message)}</td></tr>`).join('')}</tbody></table></div>`; }
  async function loadRemoteEnquiries(repaint){
    if(repaint && route() === 'admin') adminContent('enquiries');
    return enquiries();
  }
  function adminSeo(){ const s=state.seo||{}, i=state.integrations||{}; return `<h2>SEO & Google Sheet</h2><div class="admin-row">${input('seo.title','SEO Title',s.title)}${textarea('seo.description','SEO Description',s.description,4)}${textarea('seo.keywords','SEO Keywords',s.keywords,4)}${input('seo.url','Website URL',s.url)}${input('seo.image','SEO Image',s.image)}${input('integrations.emailTo','Enquiry Email',i.emailTo)}${input('integrations.googleSheetUrl','Google Sheet Web App URL',i.googleSheetUrl)}<label class="label">WhatsApp Redirect<select class="select admin-input" data-path="integrations.redirectToWhatsapp"><option value="true" ${i.redirectToWhatsapp?'selected':''}>true</option><option value="false" ${!i.redirectToWhatsapp?'selected':''}>false</option></select></label></div><div class="card card-pad" style="margin-top:16px"><b>Google Sheet Integration</b><p>Paste your Google Apps Script Web App URL in Google Sheet Web App URL. Enquiries will be posted to your Google Sheet. Supabase is used only for login authentication.</p></div>`; }
  function adminAccess(){ const u=currentUser(); const cfg=supabaseConfig(); return `<h2>Supabase Authorized Login</h2><p class="lead">Supabase is used only for authorized login authentication.</p><div class="grid grid-2"><div class="card card-pad"><b>Current User</b><p>${u ? esc(u.email) : 'Not logged in'}</p><p>${u ? esc(u.role) : ''}</p></div><div class="card card-pad"><b>Admin Emails</b><p>${esc((cfg.ADMIN_EMAILS || []).join(', ') || 'Not set')}</p></div></div><div class="card card-pad" style="margin-top:16px"><b>How to add users</b><p>Create users in Supabase Authentication, then add their role in public.profiles table. No enquiry or website data is stored in Supabase.</p></div>`; }
  function bindAdmin(tab){
    document.querySelectorAll('.admin-input').forEach(el => el.oninput = () => setPath(el.dataset.path, el.value));
    document.getElementById('addProduct')?.addEventListener('click', () => { const c=state.categories[0]; state.products.unshift({id:'product-'+Date.now(),name:'New Product',categoryId:c.id,category:c.title,image:c.image,description:'Product description.',price:'Get Quote'}); adminContent('products'); });
    document.querySelectorAll('[data-delete-product]').forEach(b => b.onclick = () => { state.products.splice(Number(b.dataset.deleteProduct),1); adminContent('products'); });
    document.querySelectorAll('[data-upload-product-image]').forEach(b => b.onclick = async () => {
      const idx = Number(b.dataset.uploadProductImage);
      const fileInput = document.querySelector(`[data-product-file="${idx}"]`);
      const file = fileInput && fileInput.files && fileInput.files[0];
      const oldText = b.textContent;
      try{
        b.textContent = 'Uploading...';
        b.disabled = true;
        await uploadProductImage(idx, file);
        toast('Image saved permanently');
        adminContent('products');
      }catch(e){
        alert(e.message || 'Image upload failed');
        b.textContent = oldText;
        b.disabled = false;
      }
    });
    document.getElementById('addCategory')?.addEventListener('click', () => { state.categories.push({id:'category-'+Date.now(),title:'New Category',subtitle:'Category description.',image:'assets/logo.png',pdfPage:''}); adminContent('categories'); });
    document.querySelectorAll('[data-delete-category]').forEach(b => b.onclick = () => { state.categories.splice(Number(b.dataset.deleteCategory),1); adminContent('categories'); });
    document.getElementById('refreshEnquiries')?.addEventListener('click', () => loadRemoteEnquiries(true));
    document.getElementById('clearEnquiries')?.addEventListener('click', async () => {
      saveEnquiries([]);
      remoteEnquiryCache = [];
      adminContent('enquiries');
    });
    document.getElementById('downloadCsv')?.addEventListener('click', downloadCsv);
  }
  function setPath(path,value){
    const parts=path.split('.'); let obj=state; for(let i=0;i<parts.length-1;i++) obj=obj[parts[i]];
    const last=parts[parts.length-1];
    if(path==='about.points') obj[last]=value.split('\n').map(x=>x.trim()).filter(Boolean);
    else if(value==='true' || value==='false') obj[last]=(value==='true');
    else obj[last]=value;
    if(path.includes('products.') && path.endsWith('.categoryId')){ const idx=Number(parts[1]); const c=category(value); if(c) state.products[idx].category=c.title; }
  }
  function downloadCsv(){ const rows=enquiries(), cols=['date','name','phone','email','product','message']; const csv=[cols.join(',')].concat(rows.map(r => cols.map(c => '"'+String(r[c]||'').replace(/"/g,'""')+'"').join(','))).join('\n'); const blob=new Blob([csv],{type:'text/csv'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='nexgen-enquiries.csv'; a.click(); URL.revokeObjectURL(a.href); }

  function render(){
    const r = route();
    if(r === 'login') return login('dashboard');
    if(r === 'dashboard') return dashboard();
    if(r === 'admin') return renderAdmin();
    if(r === 'home') app.innerHTML = home();
    else if(r === 'products') app.innerHTML = products();
    else if(r === 'about') app.innerHTML = about();
    else if(r === 'catalogue') app.innerHTML = catalogue();
    else if(r === 'contact') app.innerHTML = contact();
    else if(r.startsWith('category/')) app.innerHTML = categoryPage(r.split('/')[1]);
    else app.innerHTML = home();
    bindPublic();
  }
  async function init(){
    const sb = getSupabase();
    if(sb){
      await refreshAuthUser();
      await loadRemoteSiteData();
      sb.auth.onAuthStateChange(async () => {
        await refreshAuthUser();
        const r = route();
        if(r === 'admin' || r === 'dashboard' || r === 'login') render();
      });
    }
    render();
  }
  window.addEventListener('hashchange', async () => { await refreshAuthUser(); render(); });
  init();
})();
