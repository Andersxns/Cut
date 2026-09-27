/* Cut — progressive enhancement. Every page works without this file; this
   just makes it nicer. No analytics, no third-party requests, no storage of
   anything you type. */
(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const root = document.documentElement;
  const body = document.body;

  const ICONS = {
    copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
  };
  const svg = (name) =>
    `<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

  const isTyping = (el) => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

  // ---------------------------------------------------------------------------
  // Toast + clipboard

  let toastTimer;
  function toast(message) {
    const el = $('.toast');
    if (!el) return;
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), 2200);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.append(area);
      area.select();
      let ok = false;
      try {
        ok = document.execCommand('copy');
      } catch {}
      area.remove();
      return ok;
    }
  }

  document.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-copy], [data-copy-from]');
    if (!button) return;
    event.preventDefault();
    let text = button.dataset.copy;
    if (button.dataset.copyFrom) text = $(button.dataset.copyFrom, button.closest('.answer') || document)?.textContent.trim();
    if (!text) return;
    if (await copyText(text)) {
      toast(button.dataset.copyLabel || 'Copied to clipboard');
      button.classList.add('is-done');
      setTimeout(() => button.classList.remove('is-done'), 1200);
    } else toast('Couldn’t reach the clipboard');
  });

  // ---------------------------------------------------------------------------
  // Themes & settings


  function applyTheme(theme) {
    root.dataset.theme = theme;
    body.dataset.themePref = theme;
    const scheme = $('meta[name="color-scheme"]');
    if (scheme) scheme.content = theme === 'light' ? 'light' : theme === 'system' ? 'light dark' : 'dark';
    for (const swatch of $$('[data-set-theme]')) {
      const on = swatch.dataset.setTheme === theme;
      swatch.classList.toggle('is-on', on);
      swatch.setAttribute('aria-checked', String(on));
    }
    const radio = $(`[data-settings] input[name="theme"][value="${theme}"]`);
    if (radio) radio.checked = true;
  }

  async function saveSettings(params) {
    try {
      const response = await fetch('/settings', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(params),
        credentials: 'same-origin',
      });
      return response.ok ? response.json() : null;
    } catch {
      return null;
    }
  }

  document.addEventListener('click', (event) => {
    const swatch = event.target.closest('[data-set-theme]');
    if (swatch) {
      applyTheme(swatch.dataset.setTheme);
      saveSettings({ theme: swatch.dataset.setTheme });
    }
  });

  // Enhanced Tracking Protection presets (mirrors ETP_PRESETS on the server).
  const ETP = {
    standard: { strip: 'known', unwrap: true, amp: true, adblock: false },
    strict: { strip: 'aggressive', unwrap: true, amp: true, adblock: true },
  };

  function applyEtpPreset(form, level) {
    const preset = ETP[level];
    if (!preset) return;
    for (const [name, value] of Object.entries(preset)) {
      const field = form.elements[name];
      if (!field) continue;
      if (field.type === 'checkbox') field.checked = value;
      else field.value = value;
    }
  }

  const settingsForm = $('[data-settings]');
  if (settingsForm) {
    const status = $('[data-settings-status]', settingsForm);
    let statusTimer;
    settingsForm.addEventListener('change', async (event) => {
      const target = event.target;
      if (target.name === 'theme') applyTheme(target.value);
      if (target.name === 'etp') applyEtpPreset(settingsForm, target.value);
      if (target.closest('[data-etp-custom]')) {
        const custom = $('input[name="etp"][value="custom"]', settingsForm);
        if (custom) custom.checked = true;
      }
      if (target.name === 'blockSites' || target.name === 'boostSites') return; // saved on blur below
      save();
    });
    settingsForm.addEventListener('focusout', (event) => {
      if (event.target.name === 'blockSites' || event.target.name === 'boostSites') save();
    });
    async function save() {
      const result = await saveSettings(new FormData(settingsForm));
      const code = $('[data-code]');
      if (result?.code && code) code.value = result.code;
      const cookie = $('pre.cookie');
      if (result && cookie) cookie.textContent = result.cookie || '(no cookie — everything is at its default)';
      if (!status) return;
      status.textContent = result ? 'Saved' : 'Couldn’t save. Use the Save button.';
      clearTimeout(statusTimer);
      statusTimer = setTimeout(() => (status.textContent = ''), 2500);
    }

    // "Find in settings": filters rows and groups, like Firefox's preferences.
    const find = $('[data-prefs-find]');
    find?.addEventListener('input', () => {
      const q = find.value.trim().toLowerCase();
      let anyVisible = false;
      for (const group of $$('[data-group]')) {
        const titleMatch = group.querySelector('.group__title')?.textContent.toLowerCase().includes(q);
        let groupVisible = false;
        for (const row of $$('[data-row]', group)) {
          const show = !q || titleMatch || row.textContent.toLowerCase().includes(q);
          row.hidden = !show;
          groupVisible ||= show;
        }
        if (!$$('[data-row]', group).length) groupVisible = !q || titleMatch || group.textContent.toLowerCase().includes(q);
        group.hidden = !groupVisible;
        anyVisible ||= groupVisible;
      }
      for (const paneEl of $$('[data-pane]')) paneEl.hidden = !$$('[data-group]', paneEl).some((g) => !g.hidden);
      $('.prefs__bar')?.toggleAttribute('hidden', Boolean(q));
      const empty = $('[data-prefs-empty]');
      if (empty) empty.hidden = anyVisible;
    });

    // Highlight the section in view.
    const links = $$('.prefs__nav a');
    if (links.length && 'IntersectionObserver' in window) {
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            for (const link of links) link.classList.toggle('is-on', link.hash === `#${entry.target.id}`);
          }
        },
        { rootMargin: '-40% 0px -55% 0px' },
      );
      for (const paneEl of $$('[data-pane]')) observer.observe(paneEl);
    }
  }

  // Connection settings: "Test connection" checks the saved settings.
  const networkForm = $('[data-network]');
  networkForm?.querySelector('[data-network-test]')?.addEventListener('click', async () => {
    const status = $('[data-network-status]', networkForm);
    status.className = 'actions__status';
    status.textContent = 'Testing the saved settings…';
    try {
      const body = new URLSearchParams();
      const token = networkForm.elements.admin_token;
      if (token) body.set('admin_token', token.value);
      const response = await fetch('/settings/network/test', { method: 'POST', headers: { Accept: 'application/json' }, body, credentials: 'same-origin' });
      const result = await response.json();
      if (!result.ok) throw new Error(result.error || 'the test failed');
      status.classList.add('is-good');
      status.textContent = `${result.tor ? 'Connected through Tor.' : 'Connected, not through Tor.'} Exit address ${result.ip} · ${(result.ms / 1000).toFixed(1)} s`;
    } catch (err) {
      status.classList.add('is-bad');
      status.textContent = `Couldn’t connect: ${err.message}`;
    }
  });

  // ---------------------------------------------------------------------------
  // Dialogs: drawer, shortcuts, "add to browser"

  function closeOnBackdrop(dialog) {
    dialog.addEventListener('click', (event) => {
      if (event.target !== dialog) return;
      const r = dialog.getBoundingClientRect();
      const inside = event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom;
      if (!inside) dialog.close();
    });
  }
  for (const dialog of $$('dialog.drawer, dialog.modal')) closeOnBackdrop(dialog);

  const drawer = $('#drawer');
  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-menu-open]') && drawer?.showModal) {
      event.preventDefault();
      drawer.showModal();
    } else if (event.target.closest('[data-drawer-close]')) drawer?.close();
    else if (event.target.closest('[data-modal-close]')) event.target.closest('dialog')?.close();
    else if (event.target.closest('[data-shortcuts]')) {
      drawer?.close();
      $('#shortcuts')?.showModal();
    } else if (event.target.closest('[data-add-search]')) {
      event.preventDefault();
      drawer?.close();
      showAddSearch();
    }
  });

  function showAddSearch() {
    let dialog = $('#add-search');
    if (!dialog) {
      const template = `${location.origin}/search?q=%s`;
      dialog = document.createElement('dialog');
      dialog.className = 'modal';
      dialog.id = 'add-search';
      dialog.innerHTML = `<div class="modal__head"><h2>Add Cut to your browser</h2><button class="iconbtn" type="button" data-modal-close aria-label="Close">${svg('x')}</button></div>
        <div class="howto">
          <section><h3>Firefox</h3><p>Right-click the address bar and choose <b>Add “Cut”</b>, then pick it under Settings → Search.</p></section>
          <section><h3>Chrome, Edge, Brave &amp; Opera</h3><p>Settings → Search engine → Manage search engines → <b>Add</b>, and use this URL:</p>
            <div class="howto__url"><code></code><button class="iconbtn iconbtn--sm" type="button" data-copy-label="Search URL copied" aria-label="Copy search URL">${svg('copy')}</button></div></section>
          <section><h3>Safari</h3><p>Safari doesn’t allow custom engines. Set Cut as your homepage instead.</p></section>
        </div>`;
      $('code', dialog).textContent = template;
      $('.howto__url button', dialog).dataset.copy = template;
      document.body.append(dialog);
      closeOnBackdrop(dialog);
    }
    dialog.showModal();
  }

  // ---------------------------------------------------------------------------
  // Dropdown filters (<details>)

  const openDropdowns = () => $$('details[data-dd][open]');
  document.addEventListener(
    'toggle',
    (event) => {
      const details = event.target;
      if (!details.matches?.('details[data-dd]') || !details.open) return;
      for (const other of openDropdowns()) if (other !== details) other.open = false;
      if (details.hasAttribute('data-dd-filter')) addDropdownFilter(details);
      $('.dd__item.is-on', details)?.scrollIntoView({ block: 'nearest' });
    },
    true,
  );
  document.addEventListener('click', (event) => {
    for (const details of openDropdowns()) if (!details.contains(event.target)) details.open = false;
  });

  function addDropdownFilter(details) {
    const menu = $('.dd__menu', details);
    let input = $('.dd__search input', menu);
    if (!input) {
      const wrap = document.createElement('div');
      wrap.className = 'dd__search';
      input = document.createElement('input');
      input.type = 'search';
      input.placeholder = 'Filter…';
      input.setAttribute('aria-label', 'Filter options');
      input.autocomplete = 'off';
      wrap.append(input);
      menu.prepend(wrap);
      input.addEventListener('input', () => {
        const q = input.value.trim().toLowerCase();
        for (const item of $$('.dd__item', menu)) item.hidden = q !== '' && !item.textContent.toLowerCase().includes(q);
      });
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          const first = $$('.dd__item', menu).find((item) => !item.hidden);
          if (first) location.href = first.href;
        }
      });
    }
    if (matchMedia('(pointer: fine)').matches) setTimeout(() => input.focus(), 30);
  }

  // ---------------------------------------------------------------------------
  // Search box: clear button + autocomplete

  const PLACEHOLDERS = { web: 'Search the web, privately…', images: 'Search images…', videos: 'Search videos…', news: 'Search news…', torrents: 'Search torrents…' };

  for (const form of $$('[data-search]')) setupSearch(form);

  function setupSearch(form) {
    const input = $('.search__input', form);
    const clear = $('[data-clear]', form);
    const list = $('.ac', form);
    if (!input) return;

    const syncClear = () => clear && (clear.hidden = !input.value);
    clear?.addEventListener('click', () => {
      input.value = '';
      syncClear();
      close();
      input.focus();
    });

    for (const radio of $$('input[name="t"]', form)) {
      radio.addEventListener('change', () => {
        input.placeholder = PLACEHOLDERS[radio.value] || PLACEHOLDERS.web;
        input.focus();
      });
    }

    const enabled = body.dataset.ac === '1' && list;
    let items = [];
    let active = -1;
    let typed = input.value;
    let timer;
    let controller;

    function close() {
      if (!list) return;
      list.hidden = true;
      list.innerHTML = '';
      items = [];
      active = -1;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
    }

    function highlight(index) {
      active = index;
      items.forEach((item, i) => item.el.setAttribute('aria-selected', String(i === index)));
      if (index >= 0) {
        input.setAttribute('aria-activedescendant', items[index].el.id);
        if (!items[index].bang) input.value = items[index].value;
      } else {
        input.removeAttribute('aria-activedescendant');
        input.value = typed;
      }
    }

    function choose(item) {
      if (item.bang) {
        input.value = typed.replace(/!\S*$/, item.value);
        typed = input.value;
        close();
        input.focus();
        return;
      }
      input.value = item.value;
      close();
      form.requestSubmit ? form.requestSubmit() : form.submit();
    }

    function render(data) {
      list.innerHTML = '';
      items = [];
      const q = typed.trim();
      if (data.bangs?.length) {
        for (const bang of data.bangs) {
          const li = option(`!${bang.trigger} `, true);
          const code = document.createElement('span');
          code.className = 'ac__bang';
          code.textContent = `!${bang.trigger}`;
          const name = document.createElement('span');
          name.textContent = bang.name;
          const meta = document.createElement('span');
          meta.className = 'ac__meta';
          meta.textContent = bang.domain;
          li.append(code, name, meta);
        }
      }
      for (const phrase of data.suggestions || []) {
        const li = option(phrase, false);
        const text = document.createElement('span');
        if (phrase.toLowerCase().startsWith(q.toLowerCase()) && q) {
          text.append(document.createTextNode(phrase.slice(0, q.length)));
          const rest = document.createElement('b');
          rest.textContent = phrase.slice(q.length);
          text.append(rest);
        } else text.textContent = phrase;
        li.append(text);
      }
      if (!items.length) return close();
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      active = -1;
    }

    function option(value, bang) {
      const li = document.createElement('li');
      li.className = 'ac__item';
      li.id = `${list.id}-${items.length}`;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', 'false');
      const item = { el: li, value, bang };
      li.addEventListener('mousedown', (event) => {
        event.preventDefault();
        choose(item);
      });
      items.push(item);
      list.append(li);
      return li;
    }

    async function fetchSuggestions() {
      const q = typed.trim();
      if (!q || q.length > 120) return close();
      controller?.abort();
      controller = new AbortController();
      try {
        const response = await fetch(`/ac?q=${encodeURIComponent(q)}`, { headers: { Accept: 'application/json' }, signal: controller.signal });
        if (!response.ok) return;
        const data = await response.json();
        if (data.q === typed.trim() && document.activeElement === input) render(data);
      } catch {}
    }

    input.addEventListener('input', () => {
      typed = input.value;
      syncClear();
      if (!enabled) return;
      clearTimeout(timer);
      timer = setTimeout(fetchSuggestions, 110);
    });
    input.addEventListener('keydown', (event) => {
      if (!enabled || list.hidden) {
        if (event.key === 'Escape') input.blur();
        return;
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        let next = active + step;
        if (next >= items.length) next = -1;
        if (next < -1) next = items.length - 1;
        highlight(next);
      } else if (event.key === 'Enter' && active >= 0) {
        event.preventDefault();
        choose(items[active]);
      } else if (event.key === 'Tab' && active >= 0 && items[active].bang) {
        event.preventDefault();
        choose(items[active]);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        input.value = typed;
        close();
      }
    });
    input.addEventListener('blur', () => setTimeout(close, 120));
    form.addEventListener('submit', (event) => {
      if (!input.value.trim()) {
        event.preventDefault();
        input.focus();
      }
      close();
    });
  }

  // ---------------------------------------------------------------------------
  // "More results"

  document.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-more]');
    if (!button || event.ctrlKey || event.metaKey || event.shiftKey) return;
    event.preventDefault();
    if (button.classList.contains('is-loading')) return;
    const label = $('span', button);
    const original = label?.textContent;
    button.classList.add('is-loading');
    if (label) label.textContent = 'Loading…';
    try {
      const url = new URL(button.href, location.href);
      url.searchParams.set('frag', '1');
      const response = await fetch(url, { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
      if (!response.ok) throw new Error(String(response.status));
      const data = await response.json();
      const results = $('[data-results]');
      const template = document.createElement('template');
      template.innerHTML = data.html;
      const seen = new Set($$('[data-key]', results).map((el) => el.dataset.key));
      let added = 0;
      for (const item of Array.from(template.content.children)) {
        if (seen.has(item.dataset.key)) continue;
        item.classList.add('is-new');
        results.append(item);
        added++;
      }
      if (data.next && added) button.href = data.next;
      else button.closest('.more')?.remove();
      if (!added) toast('That’s everything for this search');
    } catch {
      toast('Couldn’t load more — try again');
    } finally {
      button.classList.remove('is-loading');
      if (label) label.textContent = original;
      // Re-check visibility so infinite scroll continues if the button is still on screen.
      if (moreWatcher && button.isConnected) {
        moreWatcher.unobserve(button);
        moreWatcher.observe(button);
      }
    }
  });

  // Infinite scroll: press "More results" automatically as it comes into view.
  const moreWatcher =
    body.dataset.infinite === '1' && 'IntersectionObserver' in window
      ? new IntersectionObserver((entries) => entries.forEach((e) => e.isIntersecting && !e.target.classList.contains('is-loading') && e.target.click()), { rootMargin: '600px 0px' })
      : null;
  if (moreWatcher) {
    const button = $('[data-more]');
    if (button) moreWatcher.observe(button);
  }

  // ---------------------------------------------------------------------------
  // Keyboard navigation (DuckDuckGo-style)

  let selected = -1;
  const resultItems = () => $$('[data-results] > *');

  function select(index) {
    const list = resultItems();
    if (!list.length) return;
    selected = Math.max(0, Math.min(index, list.length - 1));
    list.forEach((el, i) => el.classList.toggle('is-selected', i === selected));
    const el = list[selected];
    el.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }

  function openSelected(newTab) {
    const el = resultItems()[selected];
    if (!el) return;
    if (el.matches('[data-tile]')) return el.click();
    if (el.matches('.torrent')) {
      const details = $('details', el);
      if (details) details.open = !details.open;
      return;
    }
    const link = $('[data-result-link]', el) || $('a[href]', el) || (el.matches('a[href]') ? el : null);
    if (!link) return;
    if (newTab || body.dataset.newtab === '1') window.open(link.href, '_blank', 'noopener,noreferrer');
    else location.href = link.href;
  }

  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    if ($('dialog[open]')) return;
    if (body.dataset.keys === '0' && event.key !== 'Escape') return;
    const typing = isTyping(document.activeElement);
    if (event.key === 'Escape') {
      for (const details of openDropdowns()) details.open = false;
      if (typing) document.activeElement.blur();
      return;
    }
    if (typing) return;
    const searchInput = $('.search__input');
    switch (event.key) {
      case '/':
        if (!searchInput) return;
        event.preventDefault();
        searchInput.focus();
        searchInput.select();
        break;
      case '?':
        event.preventDefault();
        $('#shortcuts')?.showModal();
        break;
      case 'j':
      case 'ArrowDown':
        if (!resultItems().length) return;
        event.preventDefault();
        select(selected + 1);
        break;
      case 'k':
      case 'ArrowUp':
        if (!resultItems().length || selected < 0) return;
        event.preventDefault();
        select(selected - 1);
        break;
      case 'Enter':
      case 'o':
        if (selected < 0) return;
        event.preventDefault();
        openSelected(event.shiftKey);
        break;
      case 'm': {
        const magnet = $('[data-magnet]', resultItems()[selected] || document.createElement('div'));
        if (!magnet) return;
        copyText(magnet.href).then((ok) => ok && toast('Magnet link copied'));
        break;
      }
    }
  });

  // ---------------------------------------------------------------------------
  // Image lightbox

  const lightbox = $('#lightbox');
  if (lightbox) {
    const tiles = () => $$('[data-tile]');
    const image = $('[data-lb-img]', lightbox);
    let index = -1;
    let loader;

    function show(i) {
      const list = tiles();
      if (!list.length) return;
      index = (i + list.length) % list.length;
      const tile = list[index];
      image.src = tile.dataset.thumb;
      image.alt = tile.dataset.title || '';
      loader = new Image();
      const current = loader;
      loader.onload = () => {
        if (current === loader) image.src = tile.dataset.full;
      };
      loader.src = tile.dataset.full;
      $('[data-lb-title]', lightbox).textContent = tile.dataset.title || 'Untitled image';
      $('[data-lb-domain]', lightbox).textContent = tile.dataset.domain || '';
      $('[data-lb-dims]', lightbox).textContent = Number(tile.dataset.w) ? `${tile.dataset.w} × ${tile.dataset.h} px` : '';
      $('[data-lb-page]', lightbox).href = tile.href;
      $('[data-lb-src]', lightbox).href = tile.dataset.src;
      for (const link of $$('[data-lb-page], [data-lb-src]', lightbox)) body.dataset.newtab === '1' ? (link.target = '_blank') : link.removeAttribute('target');
      selected = resultItems().indexOf(tile);
      list.forEach((t) => t.classList.toggle('is-selected', t === tile));
      if (!lightbox.open) lightbox.showModal();
    }

    document.addEventListener('click', (event) => {
      const tile = event.target.closest('[data-tile]');
      if (!tile || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey) return;
      event.preventDefault();
      show(tiles().indexOf(tile));
    });
    $('[data-lb-prev]', lightbox).addEventListener('click', () => show(index - 1));
    $('[data-lb-next]', lightbox).addEventListener('click', () => show(index + 1));
    $('[data-lb-close]', lightbox).addEventListener('click', () => lightbox.close());
    $('.lightbox__stage', lightbox).addEventListener('click', (event) => {
      if (event.target === event.currentTarget) lightbox.close();
    });
    lightbox.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowLeft') show(index - 1);
      if (event.key === 'ArrowRight') show(index + 1);
    });
    lightbox.addEventListener('close', () => {
      loader = null;
      tiles()[index]?.scrollIntoView({ block: 'nearest' });
    });
  }

  // ---------------------------------------------------------------------------
  // Bangs page filter

  const bangFilter = $('[data-bang-filter]');
  if (bangFilter) {
    bangFilter.addEventListener('input', () => {
      const q = bangFilter.value.trim().toLowerCase().replace(/^!/, '');
      let visible = 0;
      for (const group of $$('[data-bang-group]')) {
        let groupVisible = 0;
        for (const bang of $$('[data-bang]', group)) {
          const show = !q || bang.dataset.bang.includes(q);
          bang.hidden = !show;
          groupVisible += show ? 1 : 0;
        }
        group.hidden = groupVisible === 0;
        visible += groupVisible;
      }
      $('[data-bang-empty]').hidden = visible > 0;
    });
  }

  // ---------------------------------------------------------------------------
  // Instant answers that live in your browser

  const cryptoInt = (max) => {
    // Unbiased integer in [0, max) from the Web Crypto API.
    const limit = Math.floor(0x100000000 / max) * max;
    const buffer = new Uint32Array(1);
    do crypto.getRandomValues(buffer);
    while (buffer[0] >= limit);
    return buffer[0] % max;
  };

  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  function password(card) {
    const length = Number($('[data-pw-length]', card)?.value) || Number(card.dataset.length) || 20;
    let chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    if ($('[data-pw-symbols]', card)?.checked) chars += '!@#$%^&*()-_=+[]{};:,.?/~';
    if ($('[data-pw-ambiguous]', card)?.checked) chars = chars.replace(/[Il1O0o|]/g, '');
    let out = '';
    for (let i = 0; i < length; i++) out += chars[cryptoInt(chars.length)];
    $('[data-gen-out]', card).textContent = out;
  }

  const passwordCard = $('[data-password]');
  if (passwordCard) {
    password(passwordCard);
    passwordCard.addEventListener('input', (event) => {
      if (event.target.matches('[data-pw-length]')) $('[data-pw-length-out]', passwordCard).textContent = event.target.value;
      password(passwordCard);
    });
  }

  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-regen]');
    if (!button) return;
    const card = button.closest('.answer');
    const out = $('[data-gen-out]', card);
    switch (button.dataset.regen) {
      case 'uuid': {
        const value = uuid();
        out.textContent = value;
        const copy = $('[data-copy]', card);
        if (copy) copy.dataset.copy = value;
        break;
      }
      case 'password':
        password(card);
        break;
      case 'coin':
        out.textContent = cryptoInt(2) ? 'Heads' : 'Tails';
        break;
      case 'dice': {
        const count = Number(card.dataset.count) || 1;
        const sides = Number(card.dataset.sides) || 6;
        const rolls = Array.from({ length: count }, () => cryptoInt(sides) + 1);
        $('[data-dice-faces]', card).replaceChildren(
          ...rolls.map((r) => {
            const die = document.createElement('span');
            die.className = 'die';
            die.textContent = r;
            return die;
          }),
        );
        const total = $('[data-dice-total]', card);
        if (total) total.textContent = rolls.reduce((a, b) => a + b, 0);
        break;
      }
      case 'random': {
        const lo = Number(card.dataset.lo);
        const hi = Number(card.dataset.hi);
        out.textContent = (lo + cryptoInt(hi - lo + 1)).toLocaleString('en-US');
        break;
      }
    }
  });

  // Weather: °C / °F
  for (const card of $$('[data-weather]')) {
    card.addEventListener('click', (event) => {
      const button = event.target.closest('[data-temp-unit]');
      if (!button) return;
      const unit = button.dataset.tempUnit;
      for (const b of $$('[data-temp-unit]', card)) b.setAttribute('aria-pressed', String(b === button));
      for (const el of $$('[data-temp]', card)) {
        const c = Number(el.dataset.temp);
        el.textContent = Math.round(unit === 'F' ? (c * 9) / 5 + 32 : c);
      }
      for (const el of $$('[data-unit-label]', card)) el.textContent = unit;
      for (const el of $$('[data-wind]', card)) el.textContent = Math.round(unit === 'F' ? Number(el.dataset.wind) / 1.609 : Number(el.dataset.wind));
      for (const el of $$('[data-wind-unit]', card)) el.textContent = unit === 'F' ? 'mph' : 'km/h';
    });
  }

  // World clock + live Unix time
  for (const card of $$('[data-clock]')) {
    const zone = card.dataset.clock;
    const time = new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit' });
    const date = new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    const tick = () => {
      const now = new Date();
      $('[data-clock-time]', card).textContent = time.format(now);
      $('[data-clock-date]', card).textContent = date.format(now);
    };
    tick();
    setInterval(tick, 5000);
  }
  for (const card of $$('[data-epoch]')) {
    const out = $('[data-epoch-out]', card);
    const copy = $('[data-copy]', card);
    setInterval(() => {
      const now = String(Math.floor(Date.now() / 1000));
      out.textContent = now;
      if (copy) copy.dataset.copy = now;
    }, 1000);
  }

  // Stopwatch
  const pad = (n, width = 2) => String(Math.floor(n)).padStart(width, '0');
  function formatElapsed(ms, centis = true) {
    const hours = ms / 3600000;
    const minutes = (ms / 60000) % 60;
    const seconds = (ms / 1000) % 60;
    const base = `${hours >= 1 ? pad(hours) + ':' : ''}${pad(minutes)}:${pad(seconds)}`;
    return centis ? `${base}.${pad((ms / 10) % 100)}` : base;
  }

  for (const card of $$('[data-stopwatch]')) {
    const display = $('[data-watch-time]', card);
    const start = $('[data-watch-start]', card);
    const lap = $('[data-watch-lap]', card);
    const laps = $('[data-watch-laps]', card);
    let elapsed = 0;
    let startedAt = 0;
    let frame = 0;
    const running = () => startedAt > 0;
    const now = () => elapsed + (running() ? performance.now() - startedAt : 0);
    const draw = () => {
      display.textContent = formatElapsed(now());
      if (running()) frame = requestAnimationFrame(draw);
    };
    start.addEventListener('click', () => {
      if (running()) {
        elapsed = now();
        startedAt = 0;
        cancelAnimationFrame(frame);
        start.textContent = 'Resume';
      } else {
        startedAt = performance.now();
        draw();
        start.textContent = 'Pause';
      }
      lap.disabled = !running();
    });
    lap.addEventListener('click', () => {
      const li = document.createElement('li');
      li.textContent = formatElapsed(now());
      laps.prepend(li);
    });
    $('[data-watch-reset]', card).addEventListener('click', () => {
      cancelAnimationFrame(frame);
      elapsed = 0;
      startedAt = 0;
      display.textContent = formatElapsed(0);
      laps.innerHTML = '';
      lap.disabled = true;
      start.textContent = 'Start';
    });
  }

  // Timer
  function beep() {
    if (body.dataset.sound === '0') return;
    try {
      const context = new (window.AudioContext || window.webkitAudioContext)();
      [0, 0.28, 0.56].forEach((offset) => {
        const osc = context.createOscillator();
        const gain = context.createGain();
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.0001, context.currentTime + offset);
        gain.gain.exponentialRampToValueAtTime(0.25, context.currentTime + offset + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + offset + 0.22);
        osc.connect(gain).connect(context.destination);
        osc.start(context.currentTime + offset);
        osc.stop(context.currentTime + offset + 0.24);
      });
    } catch {}
  }

  for (const card of $$('[data-timer]')) {
    const display = $('[data-timer-time]', card);
    const start = $('[data-timer-start]', card);
    const watch = $('.watch', card);
    const initial = Number(card.dataset.seconds) * 1000;
    let remaining = initial;
    let endsAt = 0;
    let interval = 0;
    const title = document.title;
    const draw = () => (display.textContent = formatElapsed(Math.max(0, remaining), false));
    const stop = () => {
      clearInterval(interval);
      endsAt = 0;
    };
    const tick = () => {
      remaining = endsAt - performance.now();
      if (remaining <= 0) {
        remaining = 0;
        stop();
        watch.classList.add('is-done');
        start.textContent = 'Start';
        document.title = '⏰ Time’s up · Cut';
        beep();
        setTimeout(() => (document.title = title), 8000);
      }
      draw();
    };
    start.addEventListener('click', () => {
      if (endsAt) {
        stop();
        start.textContent = 'Resume';
        return;
      }
      if (remaining <= 0) remaining = initial;
      watch.classList.remove('is-done');
      endsAt = performance.now() + remaining;
      interval = setInterval(tick, 200);
      start.textContent = 'Pause';
    });
    $('[data-timer-add]', card).addEventListener('click', (event) => {
      const add = Number(event.currentTarget.dataset.timerAdd) * 1000;
      remaining += add;
      if (endsAt) endsAt += add;
      watch.classList.remove('is-done');
      draw();
    });
    $('[data-timer-reset]', card).addEventListener('click', () => {
      stop();
      remaining = initial;
      watch.classList.remove('is-done');
      start.textContent = 'Start';
      draw();
    });
  }
})();
