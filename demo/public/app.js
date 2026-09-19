// A deliberately plain legacy-style UI. State exists only in this browser page.
const main = document.querySelector('main');
const scenario = new URLSearchParams(location.search).get('scenario') || 'normal';
const state = { member: '', nickname: '', unlocked: false, acknowledged: false, created: false };
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const row = (caption, value) => `<tr><td>${caption}</td><td>${escape(value)}</td></tr>`;
function show(path, html) { history.replaceState(null, '', path); main.innerHTML = html; }
function click(text, fn) { [...main.querySelectorAll('button,a')].find(el => el.textContent === text).addEventListener('click', fn); }
function search() {
  show('/search', '<h2>Member Search</h2><table><tr><td>Member number</td><td><input type="text" maxlength="5"></td></tr></table><button>Search</button>');
  click('Search', () => {
    const member = main.querySelector('input').value;
    if (!/^\d{5}$/.test(member)) { main.insertAdjacentHTML('beforeend', '<p>Enter a five-digit member number.</p>'); return; }
    state.member = member;
    show('/results', '<h2>Search Results</h2><p>Loading member records...</p>');
    setTimeout(results, scenario === 'slow' ? 2000 : 30);
  });
}
function results() {
  if (!['12345', '67890', '54321'].includes(state.member)) {
    show('/results', '<h2>Search Results</h2><p>MEMBER_NOT_FOUND</p>'); return;
  }
  show('/results', `<h2>Search Results</h2><table><tr><th>Member number</th><th>Action</th></tr><tr><td>${escape(state.member)}</td><td><button>View member</button></td></tr></table>`);
  click('View member', details);
}
function details() {
  show('/details', `<h2>Member Details</h2><table>${row('Member number', state.member)}${row('Standing', 'Active')}</table><button>Open Savings Sub-Account</button>`);
  click('Open Savings Sub-Account', savings);
}
function savings() {
  if (state.member === '54321') { show('/savings', '<h2>Open Savings Sub-Account</h2><p>PERMISSION_DENIED</p>'); return; }
  if (scenario === 'locked' && !state.unlocked) {
    show('/locked', '<h2>Session locked</h2><p>Operator intervention required. This demo unlock needs no credentials.</p><button>Unlock session</button>');
    click('Unlock session', () => { state.unlocked = true; savings(); }); return;
  }
  if (scenario === 'warning' && !state.acknowledged) {
    show('/savings', '<h2>Service notice</h2><div class="notice"><p>Notice: verify the member before continuing.</p><button>Acknowledge</button></div>');
    click('Acknowledge', () => { state.acknowledged = true; savings(); }); return;
  }
  show('/savings', `<h2>Open Savings Sub-Account</h2><table>${row('Member number', state.member)}${row('Account type', 'SAVINGS')}<tr><td>Nickname</td><td><input type="text" maxlength="30"></td></tr></table><button>Review</button>`);
  click('Review', () => {
    state.nickname = main.querySelector('input').value.trim();
    if (!state.nickname) { main.insertAdjacentHTML('beforeend', '<p>Nickname is required.</p>'); return; }
    review();
  });
}
function review() {
  show('/review', `<h2>Review Savings Sub-Account</h2><table>${row('Member number', state.member)}${row('Nickname', state.nickname)}${row('Account type', 'SAVINGS')}${row('Status', 'READY_FOR_REVIEW')}</table><p>No account has been created.</p><button>Create Account</button>`);
  click('Create Account', () => {
    state.created = true;
    show('/created', '<h2>Account Created</h2><p>Synthetic account created in this page only.</p>');
  });
}
search();
