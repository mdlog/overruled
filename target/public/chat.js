// Support chat widget. Not streaming: the assistant bubble is added only once the
// full reply has arrived, and it carries data-reply-complete="true".
// The conversation lives in this page (the `history` array) and is sent with every request.
(() => {
  const root = document.getElementById('support-chat');
  if (!root) return;

  const list = root.querySelector('#chat-messages');
  const form = root.querySelector('#chat-form');
  const input = root.querySelector('#chat-input');
  const send = root.querySelector('#chat-send');
  const toggle = root.querySelector('#chat-toggle');
  const signedIn = root.dataset.signedIn === 'true';

  /** @type {{role: 'user'|'assistant', content: string}[]} */
  const history = [];
  let busy = false;

  toggle?.addEventListener('click', () => {
    const collapsed = root.classList.toggle('is-collapsed');
    toggle.setAttribute('aria-expanded', String(!collapsed));
  });

  function scrollToEnd() {
    list.scrollTop = list.scrollHeight;
  }

  // Render plain text, turning **bold** into <strong>. Built from DOM nodes, never innerHTML.
  function renderText(el, text) {
    const parts = String(text).split(/\*\*([^*\n]+)\*\*/g);
    parts.forEach((part, i) => {
      if (!part) return;
      if (i % 2 === 1) {
        const strong = document.createElement('strong');
        strong.textContent = part;
        el.appendChild(strong);
      } else {
        el.appendChild(document.createTextNode(part));
      }
    });
  }

  function addBubble(role, text, { error = false } = {}) {
    const bubble = document.createElement('div');
    bubble.className = `msg msg--${role}${error ? ' msg--error' : ''}`;
    bubble.dataset.role = role;
    if (role === 'assistant') renderText(bubble, text);
    else bubble.textContent = text;
    if (role === 'assistant') {
      bubble.setAttribute('data-reply-complete', 'true');
      if (error) bubble.dataset.error = 'true';
    }
    list.appendChild(bubble);
    scrollToEnd();
    return bubble;
  }

  const RECEIPT_LABEL = { refund: 'Refund', store_credit: 'Store credit', escalation: 'Escalated' };

  /** Receipts come from the server's record of real database changes, not from the model's text. */
  function addReceipts(actions) {
    if (!actions?.length) return;
    const box = document.createElement('div');
    box.className = 'receipts';
    box.setAttribute('aria-label', 'Account changes');
    for (const a of actions) {
      const r = document.createElement('div');
      r.className = 'receipt';
      r.dataset.actionType = a.type;
      r.dataset.orderId = a.order_id;
      const label = document.createElement('strong');
      label.textContent = `✓ ${RECEIPT_LABEL[a.type] || a.type}`;
      r.append(label, document.createTextNode(a.description || `Order ${a.order_id}`));
      box.appendChild(r);
    }
    list.appendChild(box);
    scrollToEnd();
  }

  function showTyping() {
    const el = document.createElement('div');
    el.className = 'typing';
    el.setAttribute('aria-label', 'Assistant is typing');
    el.innerHTML = '<i></i><i></i><i></i><span>Checking your account…</span>';
    list.appendChild(el);
    scrollToEnd();
    return el;
  }

  function setBusy(value) {
    busy = value;
    send.disabled = value;
    root.setAttribute('aria-busy', String(value));
  }

  // Refresh the page content (orders / ledger) after the assistant changed something.
  async function refreshMain() {
    try {
      const res = await fetch(window.location.href, { credentials: 'same-origin' });
      if (!res.ok) return;
      const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
      const fresh = doc.getElementById('main');
      const current = document.getElementById('main');
      if (fresh && current) current.innerHTML = fresh.innerHTML;
    } catch {
      /* the page still works; it just shows the old numbers until reload */
    }
  }

  async function submit() {
    const text = input.value.trim();
    if (!text || busy || !signedIn) return;
    history.push({ role: 'user', content: text });
    addBubble('user', text);
    input.value = '';
    setBusy(true);
    const typing = showTyping();
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ messages: history }),
      });
      const data = await res.json().catch(() => ({}));
      typing.remove();
      if (!res.ok || typeof data.reply !== 'string') {
        addBubble('assistant', data.error || 'Sorry, something went wrong. Please try again.', { error: true });
        return;
      }
      history.push({ role: 'assistant', content: data.reply });
      addBubble('assistant', data.reply);
      if (data.actions?.length) {
        addReceipts(data.actions);
        refreshMain();
      }
    } catch {
      typing.remove();
      addBubble('assistant', 'Sorry, I could not reach the support service. Please check your connection and try again.', { error: true });
    } finally {
      setBusy(false);
      input.focus();
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submit();
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      submit();
    }
  });
})();
