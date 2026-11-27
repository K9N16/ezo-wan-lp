/* 1問ずつのアンケート。答えは Google フォームの formResponse へ裏で送る。
   使い方: window.SURVEYS = {owner:{...}, facility:{...}} と window.SURVEY_START = {title, html} を先に置いてから読み込む。
   各アンケート: {label, sub, key, action, sourceEntry, title, doneHtml, questions:[...]}
   質問: {id, entry, type:'radio'|'check'|'text'|'contact', q, hint, options, exclusive:[...], show(a), optionsFrom, singleWhen(a)}
   URL: ?type=owner|facility で選ぶ画面を飛ばす。?from=xx は回答経路に入る。
*/
(function () {
  'use strict';
  var ALL = window.SURVEYS;
  var START = window.SURVEY_START;
  var root = document.getElementById('sv');
  var S = null, STORE = '', type = '';
  var AUTO_MS = 700;   // 選んだ印を見せてから進む
  var LOCK_MS = 400;   // 画面が変わった直後の二度押しを受けない
  var shownAt = 0;
  var finished = false;

  var state = null;
  var qs = new URLSearchParams(location.search);
  var from = (qs.get('from') || '').replace(/[^\w\-]/g, '').slice(0, 30);
  var autoTimer = null;

  function choose(t) {
    if (type === t) return;
    type = t; S = ALL[t]; STORE = 'ezowan-survey-' + S.key;
    state = load() || { a: {}, pos: -1, from: '' };
    if (from) state.from = from;
  }
  function savedOf(t) {
    try {
      var x = JSON.parse(localStorage.getItem('ezowan-survey-' + ALL[t].key));
      return !!(x && x.pos >= 0 && Object.keys(x.a || {}).length > 0);
    } catch (e) { return false; }
  }
  /* ---------- 同じ端末からの続けての回答を断る(3日間) ---------- */
  var DONE_MS = 3 * 24 * 60 * 60 * 1000;
  function doneKey(t) { return 'ezowan-survey-done-' + ALL[t].key; }
  function doneUntil(t) {
    var ts = 0;
    try { ts = +localStorage.getItem(doneKey(t)) || 0; } catch (e) {}
    var m = document.cookie.match(new RegExp('(?:^|; )' + doneKey(t) + '=([0-9]+)'));
    if (m) ts = Math.max(ts, +m[1]);
    var until = ts + DONE_MS;
    return ts && until > Date.now() ? until : 0;
  }
  function markDone() {
    var now = Date.now();
    try { localStorage.setItem(doneKey(type), String(now)); } catch (e) {}
    document.cookie = doneKey(type) + '=' + now + '; max-age=' + (DONE_MS / 1000) + '; path=/survey; SameSite=Lax';
  }
  function renderAlready(t) {
    setBar(-1);
    var s = newScreen();
    var h = el('h2', { class: 'sv-q' }, 'この端末からは回答済みです');
    s.appendChild(h);
    var d = new Date(doneUntil(t));
    s.appendChild(el('p', { class: 'sv-hint' }, 'ご協力ありがとうございました。同じ端末からもう一度答えられるのは ' + (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + d.getHours() + '時ごろからです。'));
    var back = el('button', { class: 'sv-back', type: 'button', style: 'width:100%' }, '最初の画面へ戻る');
    back.onclick = function () { history.back(); };
    s.appendChild(back);
    var top = el('p', { style: 'margin-top:14px;text-align:center', html: '<a href="/">エゾわん！のトップへ</a>' });
    s.appendChild(top);
    focusHeading(h);
  }

  function push(pos) { history.pushState({ svType: type, svPos: pos }, ''); }

  function load() {
    try { return JSON.parse(localStorage.getItem(STORE)); } catch (e) { return null; }
  }
  function save() {
    try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (e) {}
  }
  function clearSaved() {
    try { localStorage.removeItem(STORE); } catch (e) {}
  }

  function byId(id) {
    for (var i = 0; i < S.questions.length; i++) if (S.questions[i].id === id) return S.questions[i];
  }
  function optionsOf(q) {
    if (!q.optionsFrom) return q.options;
    var picked = state.a[q.optionsFrom] || [];
    return q.options.filter(function (o) { return picked.indexOf(o) >= 0; });
  }
  function visible() {
    return S.questions.filter(function (q) { return !q.show || q.show(state.a); });
  }
  function el(tag, attrs, text) {
    var e = document.createElement(tag);
    for (var k in attrs || {}) {
      if (k === 'class') e.className = attrs[k];
      else if (k === 'html') e.innerHTML = attrs[k];
      else e.setAttribute(k, attrs[k]);
    }
    if (text != null) e.textContent = text;
    return e;
  }

  /* ---------- 進み具合 ---------- */
  var bar = el('div', { class: 'sv-bar', hidden: '' });
  var track = el('div', { class: 'sv-track', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-label': '進み具合' });
  var fill = el('div', { class: 'sv-fill' });
  var count = el('div', { class: 'sv-count' });
  var countR = el('span', { 'aria-live': 'polite' });
  track.appendChild(fill); count.appendChild(countR);
  bar.appendChild(track); bar.appendChild(count);
  var screen = el('div');
  root.appendChild(bar); root.appendChild(screen);

  function setBar(i, total) {
    if (i < 0) { bar.hidden = true; return; }
    bar.hidden = false;
    var pct = Math.round((i / total) * 100);
    fill.style.width = pct + '%';
    track.setAttribute('aria-valuenow', String(pct));
    var left = total - i - 1;
    countR.textContent = left > 0 ? 'あと ' + left + ' 問' : '最後の質問です';
    count.style.display = '';
  }

  function newScreen() {
    clearTimeout(autoTimer);
    screen.innerHTML = '';
    var s = el('div', { class: 'sv-screen' });
    screen.appendChild(s);
    window.scrollTo(0, 0);
    shownAt = Date.now();
    return s;
  }
  function focusHeading(h) {
    h.setAttribute('tabindex', '-1');
    try { h.focus({ preventScroll: true }); } catch (e) { h.focus(); }
  }

  /* ---------- 最初の画面(どちらか選ぶ) ---------- */
  function renderChooser() {
    setBar(-1);
    var s = newScreen();
    var h = el('h1', { class: 'sv-q' }, START.title);
    s.appendChild(h);
    s.appendChild(el('div', { class: 'sv-intro', html: START.html }));
    s.appendChild(el('p', { class: 'sv-label', id: 'sv-who' }, 'あてはまる方を押してください'));
    var g = el('div', { class: 'sv-who', role: 'group', 'aria-labelledby': 'sv-who' });
    Object.keys(ALL).forEach(function (t) {
      var b = el('button', { class: 'sv-whobtn', type: 'button' });
      b.appendChild(el('span', { class: 'who-t' }, ALL[t].label));
      var sub = ALL[t].sub + (doneUntil(t) ? '(回答済み)' : savedOf(t) ? '(途中まで答えています)' : '');
      b.appendChild(el('span', { class: 'who-s' }, sub));
      b.onclick = function () {
        if (Date.now() - shownAt < LOCK_MS) return;
        choose(t);
        if (doneUntil(t)) { push(-1); return renderAlready(t); }
        if (savedOf(t)) { push(-1); renderTypeStart(); } else show(0);
      };
      g.appendChild(b);
    });
    s.appendChild(g);
    s.appendChild(el('p', { class: 'sv-note', html: START.note || '' }));
    focusHeading(h);
  }

  /* ---------- 種類ごとの始まり(URL で直接来たとき・途中の答えが残っているとき) ---------- */
  function renderTypeStart() {
    if (doneUntil(type)) return renderAlready(type);
    setBar(-1);
    var s = newScreen();
    var h = el('h1', { class: 'sv-q' }, S.title);
    s.appendChild(h);
    if (!savedOf(type)) {
      s.appendChild(el('div', { class: 'sv-intro', html: START.html }));
      var start = el('button', { class: 'sv-btn', type: 'button', style: 'width:100%' }, 'はじめる');
      start.onclick = function () { show(0); };
      s.appendChild(start);
      if (START.note) s.appendChild(el('p', { class: 'sv-note', html: START.note }));
      return focusHeading(h);
    }
    s.appendChild(el('p', { class: 'sv-hint' }, '前回、途中まで答えた内容がこの端末に残っています。'));
    var go = el('button', { class: 'sv-btn', type: 'button', style: 'width:100%' }, '前回の続きから');
    go.onclick = function () {
      // 続きからでも「戻る」で1問ずつ戻れるよう、それまでの問いを履歴に積む
      var to = Math.max(0, Math.min(state.pos, visible().length - 1));
      for (var k = 0; k < to; k++) push(k);
      show(to);
    };
    var again = el('button', { class: 'sv-back', type: 'button', style: 'margin-top:10px;width:100%' }, 'はじめから答える');
    again.onclick = function () { state.a = {}; state.pos = -1; save(); show(0); };
    s.appendChild(go);
    s.appendChild(again);
    focusHeading(h);
  }

  /* ---------- 質問の画面 ---------- */
  function show(i, fromHistory) {
    if (!fromHistory) push(i);
    var list = visible();
    if (i >= list.length) return renderSubmit();
    if (i < 0) { state.pos = -1; save(); return renderChooser(); }
    state.pos = i; save();
    var q = list[i];
    setBar(i, list.length);
    var s = newScreen();
    var h = el('h2', { class: 'sv-q', id: 'q-' + q.id }, q.q);
    s.appendChild(h);
    var single = q.type === 'radio' || (q.type === 'check' && q.singleWhen && q.singleWhen(state.a));
    var how = q.type === 'text' || q.type === 'contact' ? '' : (single ? '1つ選ぶと次へ進みます' : 'いくつでも選べます');
    var hp1 = el('p', { class: 'sv-hint' });
    if (q.hint) { hp1.appendChild(document.createTextNode(q.hint)); if (how) hp1.appendChild(el('br')); }
    if (how) hp1.appendChild(el('b', null, how));
    if (q.hint || how) s.appendChild(hp1);

    // 答えで後ろの問いが増減するので、最後かどうかは毎回数え直す
    function lastNow() { return i >= visible().length - 1; }
    function label(answered) { return lastNow() ? '送信する' : (answered ? '次へ' : 'とばして次へ'); }
    function refreshBar() { var n = visible().length; setBar(Math.min(i, n - 1), n); }
    var nav = el('div', { class: 'sv-nav' });
    var back = el('button', { class: 'sv-back', type: 'button' }, '戻る');
    back.onclick = function () { history.back(); };
    var next = el('button', { class: 'sv-btn', type: 'button' }, '次へ');
    var err = el('p', { class: 'sv-err', 'aria-live': 'polite' });

    if (q.type === 'radio' || q.type === 'check') {
      var asRadio = single;
      var opts = el('div', { class: 'sv-opts', role: asRadio ? 'radiogroup' : 'group', 'aria-labelledby': 'q-' + q.id });
      var cur = state.a[q.id];
      if (q.type === 'check' && asRadio && cur && cur.length > 1) { cur = [cur[0]]; state.a[q.id] = cur; }
      optionsOf(q).forEach(function (o) {
        var on = q.type === 'radio' ? cur === o : (cur || []).indexOf(o) >= 0;
        var b = el('button', { class: 'sv-opt', type: 'button', role: asRadio ? 'radio' : 'checkbox', 'aria-checked': String(on) });
        b.appendChild(el('span', { class: 'mk', 'aria-hidden': 'true' }));
        b.appendChild(el('span', null, o));
        b.onclick = function () {
          if (Date.now() - shownAt < LOCK_MS) return;
          if (asRadio) {
            state.a[q.id] = q.type === 'radio' ? o : [o]; save();
            Array.prototype.forEach.call(opts.children, function (c) { c.setAttribute('aria-checked', String(c === b)); });
            clearTimeout(autoTimer);
            refreshBar();
            next.textContent = label(true);
            if (lastNow()) return; // 最後の問いは押しただけでは送らない
            autoTimer = setTimeout(function () { show(i + 1); }, AUTO_MS);
          } else {
            var arr = (state.a[q.id] || []).slice();
            var k = arr.indexOf(o);
            if (k >= 0) arr.splice(k, 1);
            else {
              var ex = q.exclusive || [];
              if (ex.indexOf(o) >= 0) arr = [];
              else arr = arr.filter(function (x) { return ex.indexOf(x) < 0; });
              arr.push(o);
            }
            state.a[q.id] = arr; save();
            Array.prototype.forEach.call(opts.children, function (c) {
              c.setAttribute('aria-checked', String(arr.indexOf(c.lastChild.textContent) >= 0));
            });
            refreshBar();
            next.textContent = label(arr.length > 0);
          }
        };
        opts.appendChild(b);
      });
      s.appendChild(opts);
      next.textContent = label(q.type === 'check' ? !!(cur && cur.length) : !!cur);
    } else if (q.type === 'text') {
      var ta = el('textarea', { class: 'sv-text', 'aria-labelledby': 'q-' + q.id, maxlength: '1000', placeholder: q.placeholder || '' });
      ta.value = state.a[q.id] || '';
      ta.oninput = function () {
        state.a[q.id] = ta.value; save();
        next.textContent = label(!!ta.value.trim());
      };
      s.appendChild(ta);
      ta.oninput();
    } else if (q.type === 'contact') {
      q.fields.forEach(function (f) {
        var lid = 'f-' + f.id;
        s.appendChild(el('label', { class: 'sv-label', for: lid }, f.label));
        var inp = el('input', { class: 'sv-input', id: lid, type: f.inputType || 'text', autocomplete: f.autocomplete || 'off', maxlength: '120' });
        if (f.inputType === 'email') inp.setAttribute('inputmode', 'email');
        inp.value = state.a[f.id] || '';
        inp.oninput = function () { state.a[f.id] = inp.value; save(); err.textContent = ''; };
        s.appendChild(inp);
      });
      if (q.note) s.appendChild(el('p', { class: 'sv-note', html: q.note }));
    }
    s.appendChild(err);

    next.onclick = function () {
      if (q.check) {
        var m = q.check(state.a);
        if (m) { err.textContent = m; return; }
      }
      if ((q.type === 'check' || q.type === 'radio') && state.a[q.id] === undefined) { state.a[q.id] = q.type === 'check' ? [] : ''; save(); } // とばした印
      lastNow() ? renderSubmit() : show(i + 1);
    };
    if (q.type === 'contact') next.textContent = label(true);
    nav.appendChild(back);
    nav.appendChild(next);
    s.appendChild(nav);
    focusHeading(h);
  }

  /* ---------- 送信 ---------- */
  function buildBody() {
    var body = new URLSearchParams();
    visible().forEach(function (q) {
      if (q.type === 'contact') {
        q.fields.forEach(function (f) {
          var v = (state.a[f.id] || '').trim();
          if (v) body.append(f.entry, v);
        });
        return;
      }
      var v = state.a[q.id];
      if (q.type === 'check') {
        var allowed = optionsOf(q);
        (v || []).forEach(function (x) { if (allowed.indexOf(x) >= 0) body.append(q.entry, x); });
      } else if (q.type === 'radio') {
        if (v && q.options.indexOf(v) >= 0) body.append(q.entry, v);
      } else if (v && v.trim()) {
        body.append(q.entry, v.trim());
      }
    });
    body.append(S.sourceEntry, state.from || 'direct');
    return body;
  }

  var sending = false;
  function renderSubmit() {
    if (sending) return;
    var list = visible();
    setBar(list.length - 1, list.length);
    fill.style.width = '100%';
    var hp = document.getElementById('sv-hp');
    if (hp && hp.value) return renderDone(); // 機械の送信は黙って捨てる
    if (navigator.onLine === false) return renderFail('電波がありません。電波の良いところで、もう一度押してください。答えはこの端末に残っています。');
    sending = true;
    var s = newScreen();
    var h = el('h2', { class: 'sv-q' }, '送信しています…');
    s.appendChild(h);
    focusHeading(h);
    fetch(S.action, { method: 'POST', mode: 'no-cors', body: buildBody() })
      .then(function () { sending = false; clearSaved(); renderDone(); })
      .catch(function () { sending = false; renderFail('電波の良いところで、もう一度押してください。答えはこの端末に残っています。'); });
  }

  function renderFail(msg) {
        var s2 = newScreen();
        var h2 = el('h2', { class: 'sv-q' }, '送信できませんでした');
        s2.appendChild(h2);
        s2.appendChild(el('p', { class: 'sv-hint' }, msg));
        var nav = el('div', { class: 'sv-nav' });
        var back = el('button', { class: 'sv-back', type: 'button' }, '戻る');
        back.onclick = function () { show(visible().length - 1); };
        var retry = el('button', { class: 'sv-btn', type: 'button' }, 'もう一度送信する');
        retry.onclick = renderSubmit;
        nav.appendChild(back); nav.appendChild(retry);
        s2.appendChild(nav);
        focusHeading(h2);
  }

  function renderDone() {
    finished = true;
    markDone();
    bar.hidden = true;
    var s = newScreen();
    s.className += ' sv-done';
    s.appendChild(el('div', { class: 'paw', 'aria-hidden': 'true', html: '<svg viewBox="0 0 24 24"><ellipse cx="6" cy="9.5" rx="2.2" ry="2.8"/><ellipse cx="10" cy="5.8" rx="2.2" ry="2.8"/><ellipse cx="14" cy="5.8" rx="2.2" ry="2.8"/><ellipse cx="18" cy="9.5" rx="2.2" ry="2.8"/><path d="M12 11c-3.2 0-6 3.6-6 6.2 0 1.8 1.4 2.8 3 2.8 1.2 0 2-.6 3-.6s1.8.6 3 .6c1.6 0 3-1 3-2.8 0-2.6-2.8-6.2-6-6.2z"/></svg>' }));
    var h = el('h2', { class: 'sv-q' }, '送信しました。ありがとうございました');
    s.appendChild(h);
    s.appendChild(el('div', { html: S.doneHtml }));
    focusHeading(h);
  }

  window.addEventListener('popstate', function (e) {
    if (finished || sending) return;
    var st = e.state || {};
    if (!st.svType || !ALL[st.svType]) { if (state) { state.pos = -1; save(); } return renderChooser(); }
    choose(st.svType);
    var p = typeof st.svPos === 'number' ? st.svPos : -1;
    if (p < 0) { state.pos = -1; save(); return renderTypeStart(); }
    show(Math.min(p, visible().length - 1), true);
  });

  var direct = qs.get('type');
  if (direct && ALL[direct]) {
    choose(direct);
    history.replaceState({ svType: direct, svPos: -1 }, '');
    renderTypeStart();
  } else {
    history.replaceState({ svType: null, svPos: -1 }, '');
    renderChooser();
  }
})();
