
(() => {
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];

  window.aplusToast = (message, ms = 4500) => {
    const box = $('#toast');
    if (!box) return alert(message);
    box.textContent = message;
    box.classList.remove('hidden');
    clearTimeout(window.__toastTimer);
    window.__toastTimer = setTimeout(() => box.classList.add('hidden'), ms);
  };

  window.aplusSafe = (value) => String(value ?? '').replace(/[&<>'"]/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[char]);

  function closeModal() {
    const layer = $('#modalLayer');
    if (!layer) return;
    layer.classList.add('hidden');
    document.body.classList.remove('modal-open');
    $$('.modal-page').forEach(p => p.classList.remove('active'));

    const modalHashes = ['#teacherLogin', '#studentLogin', '#teacherRegister', '#studentRegister'];
    if (modalHashes.includes(window.location.hash)) {
      history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }

  function openModal(id) {
    const layer = $('#modalLayer');
    const page = $('#' + id);
    if (!layer || !page) return;
    $$('.modal-page').forEach(p => p.classList.remove('active'));
    page.classList.add('active');
    layer.classList.remove('hidden');
    document.body.classList.add('modal-open');

    if (window.innerWidth > 760) {
      const first = page.querySelector('input, textarea, select, button');
      setTimeout(() => first?.focus(), 60);
    }
  }

  window.aplusOpenModal = openModal;
  window.aplusCloseModal = closeModal;

  document.addEventListener('click', (e) => {
    const openBtn = e.target.closest('[data-open]');
    if (openBtn) {
      e.preventDefault();
      openModal(openBtn.dataset.open);
      $('#navMenu')?.classList.remove('open');
      return;
    }

    if (e.target.closest('#closeModal') || e.target.closest('[data-close-modal]') || e.target.id === 'modalLayer') {
      e.preventDefault();
      closeModal();
      return;
    }

    const menuBtn = e.target.closest('#menuBtn');
    if (menuBtn) {
      e.preventDefault();
      $('#navMenu')?.classList.toggle('open');
      return;
    }

    /* CRITICAL: dashboard tabs for student + teacher */
    const tab = e.target.closest('[data-tab]');
    if (tab) {
      e.preventDefault();
      $$('[data-tab]').forEach(b => b.classList.remove('active'));
      tab.classList.add('active');
      $$('[data-panel]').forEach(p => p.classList.remove('active'));
      $(`[data-panel="${tab.dataset.tab}"]`)?.classList.add('active');
      return;
    }

    /* CRITICAL: admin dashboard tabs */
    const adminTab = e.target.closest('[data-admin-tab]');
    if (adminTab) {
      e.preventDefault();
      $$('[data-admin-tab]').forEach(b => b.classList.remove('active'));
      adminTab.classList.add('active');
      $$('[data-admin-panel]').forEach(p => p.classList.remove('active'));
      $(`[data-admin-panel="${adminTab.dataset.adminTab}"]`)?.classList.add('active');
      return;
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });

  document.addEventListener('DOMContentLoaded', () => {
    // Start closed on phone/desktop, but do NOT break dashboard tabs.
    closeModal();
    const year = $('#year');
    if (year) year.textContent = new Date().getFullYear();
  });

  window.addEventListener('pageshow', () => {
    setTimeout(closeModal, 30);
  });
})();

Full Page
Invite & Earn
