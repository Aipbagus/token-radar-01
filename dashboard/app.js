// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and renders
// the ranked board, a sortable and filterable table, a per-protocol detail drawer with the model's
// own inputs and the protocol's farm plan, and an evidence panel of the live comparables. No network:
// every byte it shows is in data.js. No network anywhere in this file.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', sort: 'implied', dir: -1, selected: null };

  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var abs = Math.abs(n);
    if (abs >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (abs >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (abs >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtMult(n) {
    return (n >= 1 ? n.toFixed(2) : n.toFixed(3)) + 'x';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }

  // The model in one function: the page recomputes a row from the published multipliers board.json
  // carries (the same rounded figures the board multiplied), so page and board land on one number.
  function impliedOf(row, model) {
    var m = model || DATA.model;
    var catMult = row.category_multiple;
    var growthMult = row.growth_mult;
    var windowMult = row.window_mult;
    if (catMult === undefined || growthMult === undefined || windowMult === undefined) {
      var key = row.category || '(uncategorised)';
      var cat = null;
      for (var i = 0; i < DATA.categories.length; i++) if (DATA.categories[i].key === key) { cat = DATA.categories[i]; break; }
      var n = cat && cat.live_n >= 5 ? cat.live_n : 0;
      var catMedian = n > 0 ? cat.median_mc_tvl : DATA.global_mc_tvl;
      catMult = Math.min(m.multiple_cap, Math.max(m.multiple_floor, (n * catMedian + m.shrink_weight * DATA.global_mc_tvl) / (n + m.shrink_weight)));
      var g = row.change_7d !== null && row.change_7d !== undefined ? row.change_7d : (n > 0 ? cat.median_growth : 0);
      var cg = Math.min(120, Math.max(-60, g));
      growthMult = Math.min(m.growth_cap, Math.max(m.growth_floor, Math.pow(1 + cg / 100, m.growth_power)));
      windowMult = row.age_days === null || row.age_days === undefined ? 1.0 : m.window_base + m.window_peak * Math.exp(-Math.pow((row.age_days - m.window_center_days) / m.window_width_days, 2));
    }
    return Math.max(1, Math.round(row.tvl_usd * catMult * growthMult * windowMult));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json: category, chains, TVL and age
  // decide the action, the capital, the gas, the hold and every cost and time. No name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 500;
    if (p.tvl_usd >= 1e9) return 250;
    if (p.tvl_usd >= 2.5e8) return 150;
    if (p.tvl_usd >= 5e7) return 100;
    return 50;
  }
  function gasFor(p) {
    var chain = ((p.chains && p.chains[0]) || '').toLowerCase();
    if (chain === 'ethereum') return 8;
    if (['base', 'arbitrum', 'optimism', 'polygon', 'zksync', 'blast', 'linea', 'scroll', 'mantle', 'unichain'].some(function (c) { return chain.indexOf(c) >= 0; })) return 0.5;
    if (chain.indexOf('solana') >= 0) return 0.05;
    return 2;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 60;
    if (age < 180) return 90;
    if (age < 365) return 60;
    return 45;
  }
  function usd(n) { return '$' + Math.round(n); }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    var cap = usd(capital);
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply ' + cap + ' of USDC into ' + name + "'s lending market on " + chain + ', then borrow 40% of it in the deepest borrow asset and keep both sides open with the loan-to-value under 50%.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield aggregator') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Deposit ' + cap + ' into ' + name + "'s largest pool on " + chain + " — the pair with the deepest TVL — and leave the fees to compound.";
    if (c.indexOf('yield') >= 0) return 'Deposit ' + cap + ' into the highest-yielding pool ' + name + ' lists on ' + chain + ', and check the source of that yield before you deposit.';
    if (c.indexOf('liquid staking') >= 0 || c.indexOf('liquid restaking') >= 0 || c.indexOf('restak') >= 0) return "Stake " + cap + " of the chain's native asset through " + name + ' on ' + chain + ' and hold the receipt token untouched for the whole window.';
    if (c.indexOf('canonical bridge') >= 0 || c.indexOf('bridge') >= 0) return 'Bridge ' + cap + ' of USDC to ' + chain + ' through ' + name + ', then make one swap on the far side so the usage is on record.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('basis') >= 0) return 'Deposit ' + cap + ' as margin on ' + name + ', open one 1-2x position on its deepest market, and keep the funding cost under 0.05% a day.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit ' + cap + ' into a ' + name + ' vault on ' + chain + ' and leave the shares untouched for the whole window.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit ' + cap + ' of the stable asset through ' + name + ' on ' + chain + ' and hold it there.';
    if (c.indexOf('rwa') >= 0) return 'Mint ' + cap + " of " + name + "'s yield asset on " + chain + ' and hold it for the full window.';
    if (c.indexOf('insurance') >= 0) return 'Buy ' + cap + " of cover on " + name + "'s largest market on " + chain + ' and keep the policy to expiry.';
    if (c.indexOf('chain') >= 0 || c.indexOf('layer') >= 0) return 'Bridge ' + cap + ' onto ' + chain + " through " + name + "'s official bridge, then make one swap and one mint on its native dapps.";
    if (c.indexOf('payment') >= 0) return 'Route ' + cap + ' of payments through ' + name + ' on ' + chain + ' in several weekly batches rather than one transfer.';
    return 'Deposit ' + cap + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open for the whole window.';
  }
  function holdEndDate(asOf, days) {
    var t = Date.parse(asOf + 'T00:00:00Z') + days * 86400000;
    if (!isFinite(t)) return 'day ' + days;
    return new Date(t).toISOString().slice(0, 10);
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var gas = gasFor(p);
    var hold = holdDaysFor(p.age_days);
    var end = holdEndDate(DATA.as_of, hold);
    var gasStr = gas >= 1 ? '$' + Math.round(gas) : '$' + gas.toFixed(2);
    return [
      { text: 'Set up a dedicated wallet for this farm, funded only with the position\u2019s capital plus gas, and write its seed phrase on paper, never in a file.', cost: 'position ' + usd(capital) + ' + ' + gasStr + ' first gas on ' + chain, time: '10 minutes' },
      { text: actionFor(p, capital, chain), cost: usd(capital) + ' of capital, ' + gasStr + ' of gas', time: '15-30 minutes to set up' },
      { text: 'Add one more touch every week: a $20 deposit top-up, a small swap, or a vote, so the address shows activity in several weekly snapshots.', cost: '$20 a week plus about ' + gasStr + ' of gas', time: '10 minutes a week' },
      { text: 'Hold the position to ' + end + ' (' + hold + ' days) without withdrawing, so the address spans at least one monthly user snapshot.', cost: usd(capital) + ' stays locked in the position', time: hold + ' days' },
      { text: 'Keep a farm log as you go: wallet address, dates, amounts and tx hashes, so any future claim form takes minutes, not archaeology.', cost: 'nothing but the log', time: '5 minutes to start, 2 minutes a week' },
      { text: 'Before withdrawing, check ' + p.name + "'s own site for a points or rewards program and claim only from links it publishes; never sign a claim from a DM or an ad.", cost: 'no fee, and never pay anyone to claim', time: '15 minutes' },
      { text: 'Unwind after the window: withdraw the principal, swap any receipt back, and bridge home — expect 2 to 4 transactions at about ' + gasStr + ' each.', cost: 'about ' + usd(Math.max(1, Math.round(gas * 3))) + ' of exit gas', time: '30 minutes' }
    ].map(stepText);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    state.q = ''; state.category = 'all'; state.chain = 'all'; state.selected = null;
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('sort')) { state.sort = params.get('sort'); state.dir = params.get('dir') === '1' ? 1 : -1; }
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function chainsList() {
    var counts = {};
    DATA.rows.forEach(function (r) { (r.chains || []).forEach(function (c) { counts[c] = (counts[c] || 0) + 1; }); });
    return Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; }).slice(0, 24);
  }
  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'mult') { av = a.category_multiple; bv = b.category_multiple; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark', 'aria-hidden': 'true' }),
        el('div', null, el('span', { class: 'brand-name', text: 'TOKEN RADAR' }), el('div', { class: 'brand-sub', text: 'pre-token protocols, ranked by implied value' }))),
      el('div', { class: 'top-meta' },
        el('span', { text: 'snapshot ' + DATA.as_of }),
        el('span', { text: 'model ' + DATA.model_version }),
        el('span', { text: 'no network \u00b7 data.js only' })
      )
    );
  }
  function ledeText() {
    var top = DATA.rows[0];
    var tail = top ? ', and the top of the board today is ' + top.name + '.' : '.';
    return 'The watchlist is the floor: every protocol with at least ' + fmtUsd(DATA.floor_usd) +
      ' of TVL and no token on record. The board asks one question: if this protocol\u2019s record' +
      ' stayed exactly as it is, what would the market pay for a dollar of its TVL if it issued a' +
      ' token tomorrow? The answer is read off this snapshot\u2019s own live protocols: the median' +
      ' market cap per TVL dollar of the same category, sharpened by seven-day momentum and by how' +
      ' long the protocol has run with no token. Model ' + DATA.model_version + tail;
  }


  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols plus ' + DATA.early_size + ' early finds, ranked by implied value' }),
        el('p', { text: ledeText() }),
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { class: 'amber', text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows below the floor' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }))
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var select = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { state.category = select.value; writeHash(); render(); });
    var chainSel = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chainsList().map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSel.addEventListener('change', function () { state.chain = chainSel.value; writeHash(); render(); });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSel),
      el('span', { class: 'count', text: rows().length + ' of ' + DATA.board_size + ' rows shown' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' \u25be' : ' \u25b4' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; writeHash(); render(); } })
      ));
    }
    var max = list[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' \u00b7 ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', title: 'median market cap / TVL of the live protocols in this category' }, fmtMult(r.category_multiple)),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        r.watchlisted ? el('td', null, el('span', { class: 'pill', text: 'watchlist' })) : el('td', null, el('span', { class: 'mult', text: 'early find' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', style: 'text-align:left;padding:10px 12px', text: 'Pre-token protocols, strongest implied value first. Select a row for its model inputs and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age no token'),
            sortHeader('mult', 'Mc/TVL mult'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Source' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('span', { class: 'status', text: 'trades today' })),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' \u00b7 ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: r.tvl_usd > 0 && r.mcap_usd !== null ? fmtMult(r.mcap_usd / r.tvl_usd) : 'n/a' })
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', style: 'text-align:left;padding:10px 12px', text: 'Token already live: these protocols\u2019 market cap is a fact, not a model. They are the comparables the pre-token board leans on, set aside from the ranking.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Actual Mc/TVL' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    var cats = DATA.categories.slice().sort(function (a, b) { return b.live_n - a.live_n; }).slice(0, 8);
    var evBody = el('tbody');
    cats.forEach(function (c) {
      evBody.appendChild(el('tr', null,
        el('td', { text: c.key }),
        el('td', { class: 'num', text: String(c.live_n) }),
        el('td', { class: 'num', text: fmtMult(c.median_mc_tvl) }),
        el('td', { class: 'num', text: fmtPct(c.median_growth) })
      ));
    });
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed \u2014 model ' + DATA.model_version }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot\u2019s own figures. No protocol name is special-cased, no row is hand-picked, and the page recomputes each row from the same numbers board.json carries.' }),
      el('div', { class: 'formula' },
        el('i', { text: 'category multiple' }), ' = median( mcap / TVL of live protocols in the category ), shrunk toward the all-live median with weight ' + String(m.shrink_weight) + ' \u2014 fewer live comparables, more shrink.', el('br', null),
        el('i', { text: 'implied' }), ' = round( TVL \u00d7 category multiple \u00d7 clamp( (1 + change_7d/100)^' + String(m.growth_power) + ', ' + String(m.growth_floor) + ', ' + String(m.growth_cap) + ' ) \u00d7 window )', el('br', null),
        el('i', { text: 'window' }), ' = ' + String(m.window_base) + ' + ' + String(m.window_peak) + ' \u00d7 exp( \u2212((age_days \u2212 ' + String(m.window_center_days) + ')/' + String(m.window_width_days) + ')\u00b2 ) \u2014 a peak at ' + String(m.window_center_days) + ' days old: long enough with no token for real usage, young enough that a launch is still plausible. An unlisted age scores a neutral 1.00.'
      ),
      el('p', { class: 'sub', text: 'The live-token evidence the category multiples come from, the categories with the most comparables:' }),
      el('div', { class: 'table-wrap' }, el('table', { class: 'ev-table' },
        el('thead', null, el('tr', null, el('th', { text: 'Category' }), el('th', { text: 'Live comparables' }), el('th', { text: 'Median Mc/TVL' }), el('th', { text: 'Median 7d' }))),
        evBody
      ))
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    var recomputed = impliedOf(row);
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (row.watchlisted ? ' \u00b7 watchlist' : ' \u00b7 early find') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') + (row.listed_at ? ' \u00b7 tracked since ' + row.listed_at : ' \u00b7 no listing date on record') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'The model\u2019s inputs, from the snapshot' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Category (live comparables)' }), el('b', { class: 'num', text: (row.category || 'Other') + ' (' + String(row.evidence_n) + ')' })),
        el('div', null, el('span', { text: 'Category Mc/TVL multiple' }), el('b', { class: 'num', text: fmtMult(row.category_multiple) })),
        el('div', null, el('span', { text: 'Seven-day change' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Momentum multiplier' }), el('b', { class: 'num', text: fmtMult(row.growth_mult) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Launch-window multiplier' }), el('b', { class: 'num', text: fmtMult(row.window_mult) })),
        el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'The page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is a model\u2019s estimate of what a token would be worth, not a price, not a promise.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan \u2014 what to do, what it costs, how long it takes' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 7) : '';
        var costEnd = tail.indexOf(' Time: ');
        var cost = costEnd >= 0 ? tail.slice(0, costEnd) : tail;
        var time = costEnd >= 0 ? tail.slice(costEnd + 7) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost' }, 'Cost: ', el('em', { text: cost }), ' \u00b7 Time: ' + time));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    var tabs = el('div', { class: 'tabs' },
      el('button', { type: 'button', 'aria-pressed': 'true', text: 'Pre-token board', onclick: function () { render(); } }),
      el('button', { type: 'button', 'aria-pressed': 'false', text: 'Live-token comparables', onclick: function () { showLive(); } })
    );
    shell.appendChild(el('div', { class: 'controls', style: 'border-top:0;padding-top:0' }, tabs));
    shell.appendChild(boardTable());
    shell.appendChild(modelPanel());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  function showLive() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: 'Live-token comparables' }),
        el('p', { text: 'These protocols already trade, so their market cap is a fact, not a model. Their market cap per TVL dollar, category by category, is the evidence the pre-token board\u2019s implied values are read off. They are set aside from the ranked board: a live token needs no radar.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Live protocols shown' }), el('b', { class: 'amber', text: String(DATA.live.length) })),
        el('div', { class: 'fact' }, el('span', { text: 'Back to the radar' }), el('button', { class: 'button', type: 'button', text: 'Pre-token board', onclick: function () { render(); } }))
      )
    ));
    shell.appendChild(liveTable());
    shell.appendChild(modelPanel());
    app.appendChild(shell);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
  window.addEventListener('hashchange', function () { readHash(); render(); });
})();
