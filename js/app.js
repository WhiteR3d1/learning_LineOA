(function () {
  'use strict';

  /* ============================================================
   *  ตั้งค่า  -  แก้ 2 บรรทัดนี้ให้เป็นค่าจริงของคุณ
   * ============================================================
   *  LIFF_ID : LINE Developers > LINE Login channel > แท็บ LIFF
   *            (Scope ต้องมี profile และ openid)
   *  API_URL : Apps Script > Deploy > Web app (ลงท้ายด้วย /exec)
   * ============================================================ */
  const LIFF_ID = '2011368839-uVoKq11X';
  const API_URL = 'https://script.google.com/macros/s/AKfycbwInv__4qMsE4tP68H9MwYrg2VMgygihf9vLWE1PoJrbkH503sYAoiJcRnk8Kgpy097vg/exec';

  /* ============================================================
   *  สถานะของแอป
   * ============================================================ */
  const state = {
    idToken: '',
    dashboard: null,
    categories: [],
    lessons: [],
    badges: null,
    leaderboard: null,
    checkin: null,
    history: [],
    quiz: null,
    currentLesson: null,
    charts: { points: null, category: null }
  };

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const DEFAULT_AVATAR =
    'data:image/svg+xml;utf8,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
      '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0" stop-color="#3b82ff"/><stop offset="1" stop-color="#a24dff"/></linearGradient></defs>' +
      '<rect width="100" height="100" rx="26" fill="url(#g)"/>' +
      '<circle cx="50" cy="38" r="17" fill="#fff" opacity=".9"/>' +
      '<path d="M18 92c0-19 14-30 32-30s32 11 32 30z" fill="#fff" opacity=".9"/></svg>'
    );

  /* ============================================================
   *  เรียก API ฝั่งเซิร์ฟเวอร์ (Google Apps Script)
   * ============================================================
   *  ส่งเป็น POST พร้อม Content-Type: text/plain
   *  เพื่อให้เป็น simple request จะได้ไม่เกิด CORS preflight
   *  ซึ่ง Apps Script ไม่รองรับ (ไม่ตอบ OPTIONS)
   *
   *  ทุก request จะแนบ ID Token ของ LINE ไปด้วยเสมอ
   *  เซิร์ฟเวอร์จะตรวจสอบกับ LINE ก่อนทำงานทุกครั้ง
   * ============================================================ */
  async function call(action, payload) {
    let res;
    try {
      res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: action,
          idToken: state.idToken,
          payload: payload || {}
        })
      });
    } catch (e) {
      throw new Error('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่');
    }
    if (!res.ok) throw new Error('เซิร์ฟเวอร์ตอบกลับผิดพลาด (HTTP ' + res.status + ')');

    let json;
    try {
      json = await res.json();
    } catch (e) {
      throw new Error('รูปแบบข้อมูลจากเซิร์ฟเวอร์ไม่ถูกต้อง กรุณาตรวจสอบการ Deploy ของ Apps Script');
    }

    if (!json.success) {
      if (json.code === 'AUTH') return reLogin();
      throw new Error(json.message || 'เกิดข้อผิดพลาด');
    }
    return json.data;
  }

  /** ID Token หมดอายุหรือไม่ถูกต้อง ให้เข้าสู่ระบบใหม่ */
  function reLogin() {
    Swal.fire({
      icon: 'warning',
      title: 'เซสชันหมดอายุ',
      text: 'กำลังพากลับไปเข้าสู่ระบบใหม่',
      showConfirmButton: false,
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading()
    });
    setTimeout(() => {
      try {
        if (liff.isLoggedIn()) liff.logout();
        liff.login({ redirectUri: location.href });
      } catch (e) {
        location.reload();
      }
    }, 900);
    // ค้าง promise ไว้ เพราะกำลังจะเปลี่ยนหน้าไป login อยู่แล้ว
    return new Promise(() => { });
  }

  function toast(icon, title) {
    Swal.fire({
      toast: true, position: 'top', icon, title,
      showConfirmButton: false, timer: 2200, timerProgressBar: true
    });
  }

  /** จำกัดเวลารอ promise ถ้าเกินกำหนดให้ถือว่าล้มเหลว จะได้ไม่ค้างรอไปเรื่อย ๆ */
  function withTimeout(promise, ms, message) {
    let timer;
    return Promise.race([
      Promise.resolve(promise).then(
        (v) => { clearTimeout(timer); return v; },
        (e) => { clearTimeout(timer); throw e; }
      ),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      })
    ]);
  }

  /* ============================================================
   *  ขั้นตอนเข้าสู่ระบบ
   * ============================================================ */
  async function boot() {
    // ตรวจว่าเติมค่าตั้งค่าครบหรือยัง
    if (!LIFF_ID || LIFF_ID.indexOf('ใส่_') === 0) {
      return showLogin('ยังไม่ได้ตั้งค่า LIFF_ID ในไฟล์ js/app.js (ดูขั้นตอนใน README.md)');
    }
    if (!API_URL || API_URL.indexOf('ใส่_') === 0) {
      return showLogin('ยังไม่ได้ตั้งค่า API_URL ในไฟล์ js/app.js (ดูขั้นตอนใน README.md)');
    }

    setSplash('กำลังเชื่อมต่อ LINE...');
    try {
      await liff.init({ liffId: LIFF_ID });
    } catch (e) {
      return showLogin('เริ่มต้น LIFF ไม่สำเร็จ: ' + (e.message || e) + '\n\n' +
        'สิ่งที่ต้องตรวจสอบ\n' +
        '1. ถ้าเปิดจาก Rich Menu ลิงก์ต้องเป็น https://liff.line.me/{LIFF_ID} ไม่ใช่ URL ของเว็บโดยตรง\n' +
        '2. LIFF_ID ในไฟล์ js/app.js ตรงกับใน LINE Developers\n' +
        '3. Endpoint URL ของ LIFF App ตรงกับที่อยู่ของหน้านี้\n' +
        '4. LINE Login Channel อยู่ในสถานะ Published');
    }

    // ยังไม่ได้เข้าสู่ระบบ พาไป login ทันที
    if (!liff.isLoggedIn()) {
      liff.login({ redirectUri: location.href });
      return;
    }

    setSplash('กำลังยืนยันตัวตน...');
    const idToken = liff.getIDToken();
    if (!idToken) {
      return showLogin('ไม่ได้รับ ID Token จาก LINE\nกรุณาตรวจสอบว่า LIFF App เปิด Scope openid ไว้แล้ว');
    }
    state.idToken = idToken;
    loadApp();
  }

  /** ปุ่มเข้าสู่ระบบบนหน้า login */
  function gotoLineLogin() {
    try {
      liff.login({ redirectUri: location.href });
    } catch (e) {
      location.reload();
    }
  }

  function setSplash(msg) {
    const el = $('#splashMsg');
    if (el) el.textContent = msg;
  }

  function showLogin(errorMsg) {
    $('#splash').classList.add('d-none');
    $('#loginScreen').classList.remove('d-none');
    if (errorMsg) {
      const box = $('#loginError');
      box.innerHTML = esc(errorMsg).replace(/\n/g, '<br>');
      box.classList.remove('d-none');
    }
  }

  /* ============================================================
   *  โหลดข้อมูลทั้งหมดแล้วแสดงแอป
   * ============================================================ */
  async function loadApp() {
    try {
      setSplash('กำลังโหลดข้อมูลผู้เรียน...');
      const data = await call('login');

      state.dashboard = data.dashboard;
      state.categories = data.categories.categories;
      state.passPercent = data.categories.passPercent;
      state.lessons = data.lessons;
      state.badges = data.badges;
      state.leaderboard = data.leaderboard;
      state.checkin = data.checkin;

      renderAll();

      $('#splash').classList.add('d-none');
      $('#loginScreen').classList.add('d-none');
      $('#app').classList.remove('d-none');

      call('getQuizHistory').then((h) => {
        state.history = h || [];
        renderQuizHistory();
      }).catch(() => { });
    } catch (err) {
      $('#splash').classList.add('d-none');
      showLogin('โหลดข้อมูลไม่สำเร็จ: ' + (err.message || err));
    }
  }

  function renderAll() {
    renderProfile();
    renderSummary();
    renderRecent();
    renderCharts();
    renderCheckin();
    renderLessons();
    renderQuizCategories();
    renderBadges();
    renderLeaderboard();
  }

  /* ============================================================
   *  ส่วนหัว : โปรไฟล์ + ระดับ + สถิติ
   * ============================================================ */
  function renderProfile() {
    const d = state.dashboard;
    const u = d.user, lv = d.level;

    $('#pfPicture').src = u.pictureUrl || DEFAULT_AVATAR;
    $('#pfPicture').onerror = function () { this.src = DEFAULT_AVATAR; };
    $('#pfName').textContent = u.displayName;
    $('#pfPoints').textContent = fmt(u.totalPoints);
    $('#pfLevelBadge').innerHTML = '<i class="fa-solid ' + lv.icon + '"></i> Lv.' + lv.level;
    $('#pfLevelName').innerHTML = '<i class="fa-solid fa-award"></i> ' + lv.levelName;

    $('#lpCurrent').textContent = 'ระดับ ' + lv.level + ' · ' + lv.levelName;
    $('#lpNext').textContent = lv.next
      ? 'อีก ' + fmt(lv.pointsToNext) + ' คะแนน ถึง ' + lv.next.levelName
      : 'ถึงระดับสูงสุดแล้ว';
    $('#lpFill').style.width = lv.progress + '%';

    $('#stLesson').textContent = u.lessonDone;
    $('#stLessonTotal').textContent = '/' + u.lessonTotal;
    $('#stMission').textContent = u.missionDone;
    $('#stMissionTotal').textContent = '/' + u.missionTotal;
    $('#stBadge').textContent = u.badgeCount;
    $('#stBadgeTotal').textContent = '/' + u.badgeTotal;
    $('#stRank').textContent = d.rank || '-';
  }

  function renderSummary() {
    const u = state.dashboard.user;
    $('#sumQuizCount').textContent = u.quizCount;
    $('#sumCorrect').textContent = u.quizCorrect;
    $('#sumAccuracy').textContent = u.accuracy;
    $('#sumCheckin').textContent = u.checkinCount;
    $('#sumBestStreak').textContent = u.bestStreak;
  }

  const RECENT_ICON = {
    checkin: 'fa-calendar-check', quiz: 'fa-pen-to-square',
    lesson: 'fa-book-open', badge: 'fa-medal', login: 'fa-door-open'
  };

  function renderRecent() {
    const list = state.dashboard.recent || [];
    const box = $('#recentList');
    if (!list.length) {
      box.innerHTML = '<div class="empty-note"><i class="fa-regular fa-clock"></i>ยังไม่มีกิจกรรม เริ่มจากการเช็คอินหรือทำแบบทดสอบได้เลย</div>';
      return;
    }
    box.innerHTML = list.map((r) => `
      <div class="recent-item">
        <div class="recent-icon"><i class="fa-solid ${RECENT_ICON[r.type] || 'fa-star'}"></i></div>
        <div class="recent-body">
          <p class="recent-note">${esc(r.note)}</p>
          <span class="recent-time">${esc(String(r.createdAt).substring(0, 16))}</span>
        </div>
        <span class="recent-pt">+${r.points}</span>
      </div>`).join('');
  }

  /* ============================================================
   *  กราฟ Chart.js
   * ============================================================ */
  function renderCharts() {
    const c = state.dashboard.charts;
    Chart.defaults.font.family = 'Kanit, sans-serif';
    Chart.defaults.color = '#5c5c85';

    // กราฟเส้น : คะแนนย้อนหลัง 7 วัน
    const ctx1 = $('#chartPoints').getContext('2d');
    const grad = ctx1.createLinearGradient(0, 0, 0, 230);
    grad.addColorStop(0, 'rgba(123,61,255,.35)');
    grad.addColorStop(1, 'rgba(123,61,255,0)');

    if (state.charts.points) state.charts.points.destroy();
    state.charts.points = new Chart(ctx1, {
      type: 'line',
      data: {
        labels: c.pointLabels,
        datasets: [{
          label: 'คะแนนที่ได้รับ',
          data: c.pointSeries,
          borderColor: '#7b3dff',
          backgroundColor: grad,
          borderWidth: 3, tension: .4, fill: true,
          pointBackgroundColor: '#fff', pointBorderColor: '#7b3dff',
          pointBorderWidth: 2.5, pointRadius: 4, pointHoverRadius: 6
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: '#eeecfb' } },
          x: { grid: { display: false } }
        }
      }
    });

    // กราฟแท่ง : ความแม่นยำรายหมวด
    const ctx2 = $('#chartCategory').getContext('2d');
    if (state.charts.category) state.charts.category.destroy();
    state.charts.category = new Chart(ctx2, {
      type: 'bar',
      data: {
        labels: c.categoryLabels.map((n) => (n.length > 16 ? n.substring(0, 15) + '…' : n)),
        datasets: [{
          label: 'คะแนนดีที่สุด (%)',
          data: c.categoryValues,
          backgroundColor: c.categoryColors.map((x) => x + 'cc'),
          borderRadius: 8, borderSkipped: false, barThickness: 12
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (i) => ' ทำได้ ' + i.raw + '%' } }
        },
        scales: {
          x: { beginAtZero: true, max: 100, grid: { color: '#eeecfb' } },
          y: { grid: { display: false }, ticks: { font: { size: 10 } } }
        }
      }
    });
  }

  /* ============================================================
   *  เช็คอิน
   * ============================================================ */
  function renderCheckin() {
    const ci = state.checkin;
    $('#ciStreak').textContent = ci.currentStreak;
    $('#ciTotal').textContent = ci.checkinCount;
    $('#ciBest').textContent = ci.bestStreak;
    $('#ciDate').textContent = thaiDate(new Date());

    const btn = $('#btnCheckin');
    if (ci.checkedInToday) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-circle-check"></i> วันนี้เช็คอินแล้ว';
      $('#ciTitle').textContent = 'เยี่ยมมาก เช็คอินครบแล้ววันนี้';
    } else {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-hand-pointer"></i> เช็คอินวันนี้ รับ 10+ คะแนน';
      $('#ciTitle').textContent = 'เช็คอินประจำวัน';
    }
    renderCalendar();
  }

  function renderCalendar() {
    const ci = state.checkin;
    const done = {};
    (ci.history || []).forEach((h) => { done[h.date] = h.points; });

    const names = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
    let html = names.map((n) => `<div class="ci-day-name">${n}</div>`).join('');

    // แสดง 5 สัปดาห์ โดยให้สัปดาห์ปัจจุบันอยู่แถวสุดท้าย
    const today = new Date();
    const end = new Date(today);
    end.setDate(end.getDate() + (6 - end.getDay()));
    const start = new Date(end);
    start.setDate(start.getDate() - 34);

    for (let i = 0; i < 35; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const key = ymd(d);
      const isToday = key === ymd(today);
      const isFuture = d > today;
      const cls = ['ci-day'];
      if (done[key]) cls.push('done');
      if (isToday) cls.push('today');
      if (isFuture) cls.push('future');
      html += `<div class="${cls.join(' ')}" title="${key}">${d.getDate()}` +
        (done[key] ? `<small>+${done[key]}</small>` : '') + '</div>';
    }
    $('#ciCalendar').innerHTML = html;
  }

  async function doCheckin() {
    const btn = $('#btnCheckin');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังบันทึก...';
    try {
      const res = await call('checkIn');
      state.dashboard = res.dashboard;
      state.checkin.checkedInToday = true;
      state.checkin.currentStreak = res.streak;
      state.checkin.checkinCount += 1;
      state.checkin.bestStreak = Math.max(state.checkin.bestStreak, res.streak);
      state.checkin.history.push({ date: ymd(new Date()), points: res.points, streak: res.streak });

      renderProfile(); renderSummary(); renderRecent(); renderCharts(); renderCheckin();

      await Swal.fire({
        icon: 'success',
        title: 'เช็คอินสำเร็จ',
        html: `<div style="font-size:32px;font-weight:700;color:#7b3dff;margin:6px 0">+${res.points} คะแนน</div>
               <div style="font-size:13px;color:#5c5c85">พื้นฐาน ${res.base} คะแนน + โบนัสต่อเนื่อง ${res.bonus} คะแนน</div>
               <div style="margin-top:10px;font-size:14px"><i class="fa-solid fa-fire" style="color:#ff7a3d"></i>
               เช็คอินต่อเนื่อง <b>${res.streak}</b> วัน</div>`,
        confirmButtonText: 'เยี่ยมมาก'
      });
      await showNewBadges(res.newBadges);
      refreshLeaderboard();
    } catch (err) {
      renderCheckin();
      Swal.fire({ icon: 'info', title: 'แจ้งเตือน', text: err.message || String(err) });
    }
  }

  /* ============================================================
   *  บทเรียน
   * ============================================================ */
  function renderLessons() {
    $('#lessonGrid').innerHTML = state.lessons.map((l) => `
      <div class="item-card" data-lesson="${l.lessonId}">
        <div class="ic-top">
          <div class="ic-icon" style="background:linear-gradient(135deg,${l.color},${shade(l.color)})">
            <i class="fa-solid ${l.icon}"></i>
          </div>
          <div>
            <p class="ic-no">บทที่ ${l.no} · ${esc(l.pages)}</p>
            <h4 class="ic-title">${esc(l.title)}</h4>
          </div>
        </div>
        <p class="ic-desc">${esc(l.summary)}</p>
        <div class="ic-foot">
          <span class="ic-meta"><i class="fa-solid fa-bullseye"></i> ${esc(l.objective)}</span>
          <span class="pill ${l.done ? 'pill-done' : 'pill-todo'}">
            ${l.done ? '<i class="fa-solid fa-check"></i> อ่านแล้ว' : 'ยังไม่อ่าน'}</span>
        </div>
      </div>`).join('');

    $$('#lessonGrid .item-card').forEach((el) => {
      el.addEventListener('click', () => openLesson(el.dataset.lesson));
    });
  }

  let lessonModal;
  function openLesson(lessonId) {
    const l = state.lessons.find((x) => x.lessonId === lessonId);
    if (!l) return;
    state.currentLesson = l;

    $('#lsPages').textContent = 'บทที่ ' + l.no + ' · อ้างอิงใบเนื้อหา ' + l.pages;
    $('#lsTitle').textContent = l.title;
    $('#lsObjective').innerHTML = '<i class="fa-solid fa-bullseye"></i> วัตถุประสงค์ : ' + esc(l.objective);
    $('#lsContent').innerHTML = l.content;

    const btn = $('#btnLessonDone');
    if (l.done) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-circle-check"></i> อ่านบทเรียนนี้จบแล้ว';
    } else {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-check"></i> อ่านจบแล้ว รับ 20 คะแนน';
    }

    lessonModal = lessonModal || new bootstrap.Modal($('#lessonModal'));
    lessonModal.show();
    $('#lessonModal .modal-body').scrollTop = 0;
  }

  async function finishLesson() {
    const l = state.currentLesson;
    if (!l || l.done) return;
    const btn = $('#btnLessonDone');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังบันทึก...';
    try {
      const res = await call('completeLesson', { lessonId: l.lessonId });
      l.done = true;
      state.dashboard = res.dashboard;
      renderProfile(); renderSummary(); renderRecent(); renderCharts(); renderLessons();
      lessonModal.hide();
      if (!res.already) {
        toast('success', 'อ่านบทเรียนจบ รับ ' + res.points + ' คะแนน');
        await showNewBadges(res.newBadges);
        refreshLeaderboard();
      }
    } catch (err) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-check"></i> อ่านจบแล้ว รับ 20 คะแนน';
      Swal.fire({ icon: 'error', title: 'บันทึกไม่สำเร็จ', text: err.message || String(err) });
    }
  }

  /* ============================================================
   *  หมวดหมู่แบบทดสอบ
   * ============================================================ */
  function renderQuizCategories() {
    $('#quizGrid').innerHTML = state.categories.map((c) => {
      const hasScore = c.attempts > 0;
      return `
      <div class="item-card" data-cat="${c.categoryId}">
        <div class="ic-top">
          <div class="ic-icon" style="background:linear-gradient(135deg,${c.color},${shade(c.color)})">
            <i class="fa-solid ${c.icon}"></i>
          </div>
          <div>
            <p class="ic-no">หมวดที่ ${c.categoryId.replace('C', '')} · ${c.questionCount} ข้อ</p>
            <h4 class="ic-title">${esc(c.name)}</h4>
          </div>
        </div>
        <p class="ic-desc">${esc(c.subtitle)}</p>
        ${hasScore ? `<div class="mini-bar"><span style="width:${c.best}%"></span></div>
          <p class="ic-meta" style="margin:7px 0 0">คะแนนดีที่สุด ${c.bestScore}/${c.bestTotal} (${c.best}%)</p>` : ''}
        <div class="ic-foot">
          <span class="ic-meta"><i class="fa-solid fa-rotate"></i> ทำแล้ว ${c.attempts} ครั้ง</span>
          ${hasScore
            ? `<span class="pill ${c.best >= state.passPercent ? 'pill-done' : 'pill-best'}">${c.best}%</span>`
            : '<span class="pill pill-todo">เริ่มทำ</span>'}
        </div>
      </div>`;
    }).join('');

    $$('#quizGrid .item-card').forEach((el) => {
      el.addEventListener('click', () => beginQuiz(el.dataset.cat));
    });
  }

  function renderQuizHistory() {
    const body = $('#quizHistoryBody');
    if (!state.history.length) {
      body.innerHTML = '<tr><td colspan="5"><div class="empty-note"><i class="fa-regular fa-file-lines"></i>ยังไม่มีประวัติการทำแบบทดสอบ</div></td></tr>';
      return;
    }
    body.innerHTML = state.history.map((r) => `
      <tr>
        <td style="white-space:nowrap">${esc(String(r.createdAt).substring(0, 16))}</td>
        <td>${esc(r.categoryName)}</td>
        <td class="text-center">${r.score}/${r.total}</td>
        <td class="text-center">
          <span class="score-pill ${r.percent >= state.passPercent ? 'pass' : 'fail'}">${r.percent}%</span>
        </td>
        <td class="text-center">+${r.points}</td>
      </tr>`).join('');
  }

  /* ============================================================
   *  เครื่องมือทำแบบทดสอบ
   * ============================================================ */
  let quizModal;

  async function beginQuiz(categoryId) {
    Swal.fire({
      title: 'กำลังเตรียมข้อสอบ',
      html: 'กรุณารอสักครู่...',
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading()
    });
    try {
      const data = await call('startQuiz', { categoryId: categoryId });
      Swal.close();
      state.quiz = {
        categoryId: categoryId,
        attemptId: data.attemptId,
        category: data.category,
        questions: data.questions,
        index: 0,
        score: 0,
        answers: [],
        startTime: Date.now(),
        answered: false
      };
      $('#qzResult').classList.add('d-none');
      $('#qzQuestionBox').classList.remove('d-none');
      $('#qzResultActions').classList.add('d-none');
      $('#btnQuizNext').classList.add('d-none');

      quizModal = quizModal || new bootstrap.Modal($('#quizModal'));
      quizModal.show();
      renderQuestion();
    } catch (err) {
      Swal.fire({ icon: 'error', title: 'เริ่มแบบทดสอบไม่สำเร็จ', text: err.message || String(err) });
    }
  }

  function renderQuestion() {
    const q = state.quiz;
    const item = q.questions[q.index];
    q.answered = false;

    $('#qzCategory').innerHTML = '<i class="fa-solid ' + q.category.icon + '"></i> ' + esc(q.category.name);
    $('#qzCounter').textContent = 'ข้อ ' + (q.index + 1) + ' / ' + q.questions.length;
    $('#qzFill').style.width = ((q.index) / q.questions.length * 100) + '%';
    $('#qzScore').innerHTML = '<i class="fa-solid fa-star"></i> ' + q.score;

    $('#qzQuestion').textContent = (q.index + 1) + '. ' + item.question;
    $('#qzChoices').innerHTML = item.choices.map((c) => `
      <button class="choice" data-key="${c.key}">
        <span class="choice-key">${c.key}</span>
        <span class="choice-text">${esc(c.text)}</span>
      </button>`).join('');

    $$('#qzChoices .choice').forEach((btn) => {
      btn.addEventListener('click', () => answerQuestion(btn.dataset.key));
    });

    const fb = $('#qzFeedback');
    fb.classList.add('d-none');
    fb.classList.remove('ok', 'no');
    $('#btnQuizNext').classList.add('d-none');
    $('#quizModal .modal-body').scrollTop = 0;
  }

  function answerQuestion(chosen) {
    const q = state.quiz;
    if (q.answered) return;
    q.answered = true;

    const item = q.questions[q.index];
    const isCorrect = chosen === item.answer;
    if (isCorrect) q.score++;
    q.answers.push({ questionId: item.questionId, chosen: chosen });

    $$('#qzChoices .choice').forEach((btn) => {
      btn.disabled = true;
      const key = btn.dataset.key;
      if (key === item.answer) btn.classList.add('correct');
      else if (key === chosen) btn.classList.add('wrong');
    });

    const answerText = (item.choices.find((c) => c.key === item.answer) || {}).text || '';
    const fb = $('#qzFeedback');
    fb.classList.remove('d-none');
    fb.classList.add(isCorrect ? 'ok' : 'no');
    $('#fbTitle').textContent = isCorrect ? 'ตอบถูกต้อง' : 'ยังไม่ถูก ลองทบทวนอีกครั้ง';
    $('#fbAnswer').textContent = item.answer + '. ' + answerText;
    $('#fbExplain').textContent = item.explain;
    $('#fbSource').textContent = item.source ? 'อ้างอิง : ' + item.source : '';

    $('#qzScore').innerHTML = '<i class="fa-solid fa-star"></i> ' + q.score;
    $('#qzFill').style.width = ((q.index + 1) / q.questions.length * 100) + '%';

    const btn = $('#btnQuizNext');
    btn.classList.remove('d-none');
    btn.innerHTML = (q.index + 1 >= q.questions.length)
      ? 'ดูผลคะแนน <i class="fa-solid fa-flag-checkered"></i>'
      : 'ข้อถัดไป <i class="fa-solid fa-arrow-right"></i>';

    setTimeout(() => { fb.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, 120);
  }

  async function nextQuestion() {
    const q = state.quiz;
    if (q.index + 1 < q.questions.length) {
      q.index++;
      renderQuestion();
      return;
    }
    await submitQuiz();
  }

  async function submitQuiz() {
    const q = state.quiz;
    const timeUsed = Math.round((Date.now() - q.startTime) / 1000);

    $('#btnQuizNext').disabled = true;
    $('#btnQuizNext').innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังบันทึกผล...';

    try {
      const res = await call('submitQuiz', {
        categoryId: q.categoryId,
        attemptId: q.attemptId,
        timeUsed: timeUsed,
        answers: q.answers
      });

      state.dashboard = res.dashboard;
      showResult(res, timeUsed);

      const cat = state.categories.find((c) => c.categoryId === q.categoryId);
      if (cat) {
        cat.attempts += 1;
        if (res.percent > cat.best) {
          cat.best = res.percent; cat.bestScore = res.score; cat.bestTotal = res.total;
        }
      }
      renderProfile(); renderSummary(); renderRecent(); renderCharts(); renderQuizCategories();

      call('getQuizHistory').then((h) => {
        state.history = h || [];
        renderQuizHistory();
      }).catch(() => { });

      state.pendingBadges = res.newBadges || [];
      refreshLeaderboard();
    } catch (err) {
      $('#btnQuizNext').disabled = false;
      $('#btnQuizNext').innerHTML = 'ลองส่งอีกครั้ง <i class="fa-solid fa-rotate-right"></i>';
      Swal.fire({ icon: 'error', title: 'บันทึกผลไม่สำเร็จ', text: err.message || String(err) });
    }
  }

  function showResult(res, timeUsed) {
    $('#qzQuestionBox').classList.add('d-none');
    $('#btnQuizNext').classList.add('d-none');
    $('#btnQuizNext').disabled = false;
    $('#qzResult').classList.remove('d-none');
    $('#qzResultActions').classList.remove('d-none');

    $('#resPercent').textContent = res.percent;
    $('#resScore').textContent = res.score + '/' + res.total;
    $('#resPoints').textContent = '+' + res.points;
    $('#resTime').textContent = mmss(timeUsed);

    const deg = Math.round(res.percent * 3.6);
    const color = res.percent >= 80 ? '#22c58b' : (res.percent >= 50 ? '#7b3dff' : '#ef5350');
    $('.res-ring').style.background =
      `conic-gradient(${color} 0deg, ${color} ${deg}deg, #eeecfb ${deg}deg)`;
    $('#resPercent').style.color = color;

    let title, sub;
    if (res.percent === 100) { title = 'สุดยอด ทำได้เต็ม'; sub = 'ตอบถูกทุกข้อ รับโบนัสพิเศษ ' + res.bonus + ' คะแนน'; }
    else if (res.passed) { title = 'ผ่านเกณฑ์แล้ว'; sub = 'ทำได้ดีมาก ผ่านเกณฑ์ ' + res.passPercent + '% ' + (res.bonus ? 'รับโบนัส ' + res.bonus + ' คะแนน' : ''); }
    else { title = 'ยังไม่ผ่านเกณฑ์'; sub = 'ทบทวนเนื้อหาแล้วลองทำใหม่อีกครั้งได้เลย เกณฑ์ผ่านคือ ' + res.passPercent + '%'; }
    $('#resTitle').textContent = title;
    $('#resSub').textContent = sub;

    $('#resReview').innerHTML =
      '<h6 style="margin:18px 0 10px;font-size:14px"><i class="fa-solid fa-list-check"></i> เฉลยและคำอธิบายรายข้อ</h6>' +
      res.detail.map((d, i) => `
        <div class="rev-item ${d.isCorrect ? 'ok' : 'no'}">
          <p class="rev-q">${i + 1}. ${esc(d.question)}</p>
          <p class="rev-a">คำตอบของคุณ : <b>${esc(d.chosen || '-')}</b>
             ${d.isCorrect ? '<span style="color:#0f9d6b"><i class="fa-solid fa-check"></i> ถูกต้อง</span>'
                           : '· เฉลย : <b>' + esc(d.correct) + '</b>'}</p>
          <p class="rev-ex">${esc(d.explain)}</p>
        </div>`).join('');
  }

  async function closeQuizResult() {
    quizModal.hide();
    const badges = state.pendingBadges || [];
    state.pendingBadges = [];
    await showNewBadges(badges);
  }

  function confirmCloseQuiz() {
    if ($('#qzResult').classList.contains('d-none') && state.quiz && state.quiz.answers.length) {
      Swal.fire({
        icon: 'warning',
        title: 'ออกจากแบบทดสอบ',
        text: 'คำตอบที่ทำไว้จะไม่ถูกบันทึก ต้องการออกหรือไม่',
        showCancelButton: true,
        confirmButtonText: 'ออกจากแบบทดสอบ',
        cancelButtonText: 'ทำต่อ'
      }).then((r) => { if (r.isConfirmed) quizModal.hide(); });
    } else {
      closeQuizResult();
    }
  }

  /* ============================================================
   *  Badge
   * ============================================================ */
  function renderBadges() {
    const b = state.badges;
    $('#bgEarned').textContent = b.earnedCount;
    $('#bgTotal').textContent = b.total;
    $('#bgFill').style.width = (b.total ? Math.round(b.earnedCount / b.total * 100) : 0) + '%';

    $('#badgeGrid').innerHTML = b.badges.map((x) => `
      <div class="badge-card ${x.earned ? '' : 'locked'}">
        ${x.earned ? '<span class="bc-earned"><i class="fa-solid fa-check"></i></span>' : ''}
        <div class="badge-medal" style="background:linear-gradient(135deg,${x.color},${shade(x.color)});
             box-shadow:0 8px 20px ${x.color}55">
          <i class="fa-solid ${x.earned ? x.icon : 'fa-lock'}"></i>
        </div>
        <p class="bc-name">${esc(x.name)}</p>
        <p class="bc-desc">${esc(x.description)}</p>
        ${x.earned
          ? `<p class="bc-count" style="color:#0f9d6b"><i class="fa-solid fa-calendar-check"></i> ${esc(String(x.earnedAt).substring(0, 10))}</p>`
          : `<div class="bc-progress"><span style="width:${x.percent}%"></span></div>
             <p class="bc-count">${x.current} / ${x.target}</p>`}
      </div>`).join('');
  }

  async function showNewBadges(list) {
    if (!list || !list.length) return;
    for (const b of list) {
      await Swal.fire({
        title: 'ปลดล็อกเหรียญใหม่',
        html: `<div class="badge-pop" style="background:linear-gradient(135deg,${b.color},${shade(b.color)})">
                 <i class="fa-solid ${b.icon}"></i></div>
               <div style="font-size:18px;font-weight:600;color:#1b1b3a">${esc(b.name)}</div>
               <div style="font-size:13px;color:#5c5c85;margin-top:5px">${esc(b.description)}</div>
               <div style="margin-top:10px;font-size:15px;color:#7b3dff;font-weight:600">+${b.points} คะแนน</div>`,
        confirmButtonText: 'เยี่ยม'
      });
    }
    // โหลดสถานะ Badge ใหม่
    try {
      state.badges = await call('getBadges');
      renderBadges();
      state.dashboard = await call('getDashboard');
      renderProfile();
    } catch (e) { /* ข้าม */ }
  }

  /* ============================================================
   *  กระดานอันดับ
   * ============================================================ */
  function renderLeaderboard() {
    const lb = state.leaderboard;
    const top = lb.top || [];

    // แท่นสามอันดับแรก
    const order = [1, 0, 2]; // ที่ 2 - ที่ 1 - ที่ 3
    $('#podium').innerHTML = order.map((i) => {
      const u = top[i];
      if (!u) return '<div></div>';
      return `
      <div class="pod pod-${u.rank}">
        <div class="pod-rank">${u.rank}</div>
        <img src="${u.pictureUrl || DEFAULT_AVATAR}" onerror="this.src='${DEFAULT_AVATAR}'">
        <p class="pod-name">${esc(u.displayName)}</p>
        <div class="pod-pt">${fmt(u.totalPoints)}</div>
        <div class="pod-lv">Lv.${u.level} ${esc(u.levelName)}</div>
      </div>`;
    }).join('');

    const rest = top.slice(3);
    $('#rankList').innerHTML = rest.length ? rest.map((u) => rankRow(u)).join('')
      : '<div class="empty-note"><i class="fa-solid fa-users"></i>ยังมีผู้เรียนไม่ถึง 4 คนในระบบ</div>';

    const bar = $('#myRankBar');
    if (lb.me && lb.me.rank > 3) {
      bar.classList.remove('d-none');
      bar.innerHTML = `
        <span class="rr-num" style="color:#fff">#${lb.me.rank}</span>
        <img src="${lb.me.pictureUrl || DEFAULT_AVATAR}" onerror="this.src='${DEFAULT_AVATAR}'">
        <div class="rr-body">
          <p class="rr-name">อันดับของคุณ · ${esc(lb.me.displayName)}</p>
          <span class="rr-meta" style="color:rgba(255,255,255,.85)">
            จากผู้เรียนทั้งหมด ${lb.totalStudents} คน</span>
        </div>
        <span class="rr-pt">${fmt(lb.me.totalPoints)}</span>`;
    } else {
      bar.classList.add('d-none');
    }
  }

  function rankRow(u) {
    return `
      <div class="rank-row ${u.isMe ? 'me' : ''}">
        <span class="rr-num">${u.rank}</span>
        <img src="${u.pictureUrl || DEFAULT_AVATAR}" onerror="this.src='${DEFAULT_AVATAR}'">
        <div class="rr-body">
          <p class="rr-name">${esc(u.displayName)}${u.isMe ? ' (คุณ)' : ''}</p>
          <span class="rr-meta">Lv.${u.level} ${esc(u.levelName)} ·
            <i class="fa-solid fa-medal"></i> ${u.badgeCount} ·
            <i class="fa-solid fa-pen-to-square"></i> ${u.quizCount}</span>
        </div>
        <span class="rr-pt">${fmt(u.totalPoints)}</span>
      </div>`;
  }

  function refreshLeaderboard() {
    call('getLeaderboard').then((lb) => {
      state.leaderboard = lb;
      renderLeaderboard();
    }).catch(() => { });
  }

  /* ============================================================
   *  แท็บ
   * ============================================================ */
  function switchTab(name) {
    $$('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    $$('.tab-pane').forEach((p) => p.classList.toggle('active', p.id === 'tab-' + name));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ============================================================
   *  ฟังก์ชันช่วยเหลือ
   * ============================================================ */
  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function fmt(n) { return Number(n || 0).toLocaleString('th-TH'); }
  function mmss(s) {
    const m = Math.floor(s / 60), r = s % 60;
    return m + ':' + String(r).padStart(2, '0');
  }
  function ymd(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
      '-' + String(d.getDate()).padStart(2, '0');
  }
  const TH_MONTH = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
  const TH_DAY = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
  function thaiDate(d) {
    return 'วัน' + TH_DAY[d.getDay()] + 'ที่ ' + d.getDate() + ' ' +
      TH_MONTH[d.getMonth()] + ' ' + (d.getFullYear() + 543);
  }
  /** ทำสีให้เข้มขึ้นเล็กน้อย สำหรับไล่เฉดในไอคอน */
  function shade(hex) {
    try {
      const c = String(hex).replace('#', '');
      const n = parseInt(c.length === 3 ? c.split('').map((x) => x + x).join('') : c, 16);
      const r = Math.max(0, ((n >> 16) & 255) - 45);
      const g = Math.max(0, ((n >> 8) & 255) - 45);
      const b = Math.max(0, (n & 255) - 20);
      return 'rgb(' + r + ',' + g + ',' + b + ')';
    } catch (e) { return hex; }
  }

  /* ============================================================
   *  ผูกเหตุการณ์ต่าง ๆ
   * ============================================================ */
  document.addEventListener('DOMContentLoaded', () => {
    $('#btnLogin').addEventListener('click', () => gotoLineLogin(false));
    $$('.tab-btn').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
    $$('[data-goto]').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.goto)));
    $('#btnCheckin').addEventListener('click', doCheckin);
    $('#btnLessonDone').addEventListener('click', finishLesson);
    $('#btnQuizNext').addEventListener('click', nextQuestion);
    $('#btnQuizClose').addEventListener('click', confirmCloseQuiz);
    $('#btnQuizFinish').addEventListener('click', closeQuizResult);
    $('#btnQuizRetry').addEventListener('click', () => {
      const cid = state.quiz.categoryId;
      quizModal.hide();
      setTimeout(() => beginQuiz(cid), 350);
    });
    boot();
  });

})();
