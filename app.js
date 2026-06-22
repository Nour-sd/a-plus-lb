import { initializeApp } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, addDoc, collection, query, where, onSnapshot, getDocs, updateDoc, serverTimestamp, deleteDoc, Timestamp } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-storage.js";
import { firebaseConfig, PAYMENT_PHONE } from "./firebase-config.js";

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const safe = (v) => window.aplusSafe ? window.aplusSafe(v) : String(v ?? "");
const toast = (m) => window.aplusToast ? window.aplusToast(cleanFirebaseError(m), 6000) : alert(cleanFirebaseError(m));

let app, auth, db, storage;
let currentUser = null;
let currentProfile = null;
let activeChatId = null;
let activeChatName = "";
let unsubs = [];
let messageUnsub = null;
let firebaseReady = false;

try {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  storage = getStorage(app);
  firebaseReady = true;
} catch (error) {
  console.error("Firebase init error", error);
  toast("Firebase config error. Check assets/js/firebase-config.js");
}

function cleanFirebaseError(error) {
  const msg = typeof error === "string" ? error : (error?.message || "Something went wrong.");
  return msg.replace("Firebase: ", "").replace(/\s*\((auth|firestore|storage)\/.*?\)\.?/g, "");
}
function stopLive() { unsubs.forEach(fn => typeof fn === "function" && fn()); unsubs = []; if (messageUnsub) { messageUnsub(); messageUnsub = null; } }
function live(q, cb) { const off = onSnapshot(q, cb, err => { console.error(err); toast(err); }); unsubs.push(off); return off; }
function sortNewest(rows) { return rows.sort((a,b) => (b.createdAt?.seconds || b.updatedAt?.seconds || 0) - (a.createdAt?.seconds || a.updatedAt?.seconds || 0)); }
function oneWeekFromNow() { return Timestamp.fromDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)); }
function isExpired(docData) {
  const seconds = docData?.expiresAt?.seconds || docData?.createdAt?.seconds;
  return seconds ? seconds < Math.floor(Date.now() / 1000) - (7 * 24 * 60 * 60) : false;
}
function isTeacherApproved() { return currentProfile?.role === "teacher" && currentProfile?.status === "approved"; }
function isPdfOrZip(file) { return !!file && (/\.(pdf|zip)$/i.test(file.name) || ["application/pdf", "application/zip", "application/x-zip-compressed"].includes(file.type)); }
function requireLogin() { if (!currentUser) { window.aplusOpenModal?.("studentLogin"); return false; } return true; }
function isAdmin() { return currentProfile?.role === "admin" && currentProfile?.status === "approved"; }

function ensureAccountBar() {
  let bar = $("#accountBar");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "accountBar";
    bar.className = "account-bar hidden";
    document.body.appendChild(bar);
  }
  return bar;
}
function updateAccountBar() {
  const bar = ensureAccountBar();
  const dashboardVisible = $("#dashboardApp") && !$("#dashboardApp").classList.contains("hidden");
  if (!currentUser || !currentProfile || dashboardVisible) { bar.classList.add("hidden"); return; }
  const dashButton = isAdmin()
    ? `<a class="primary small" href="/admin/">Admin dashboard</a>`
    : `<button type="button" id="backToDash" class="primary small">Back to dashboard</button>`;
  bar.innerHTML = `<strong>${safe(currentProfile.name || currentProfile.email)}</strong><span>${safe(currentProfile.role)} account</span>${dashButton}<button type="button" id="barLogout" class="danger small">Logout</button>`;
  bar.classList.remove("hidden");
}
function showPublic(keepLogged = false) {
  stopLive();
  $("#publicApp")?.classList.remove("hidden");
  $("#dashboardApp")?.classList.add("hidden");
  if (!keepLogged) sessionStorage.removeItem("aplusBrowsePublic");
  loadPublicCourses();
  updateAccountBar();
}
function browseWebsite() {
  sessionStorage.setItem("aplusBrowsePublic", "1");
  showPublic(true);
  setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 30);
}
function showDashboard() {
  if (isAdmin()) { showPublic(true); return; }
  sessionStorage.removeItem("aplusBrowsePublic");
  stopLive();
  $("#publicApp")?.classList.add("hidden");
  $("#dashboardApp")?.classList.remove("hidden");
  ensureAccountBar().classList.add("hidden");
  $("#dashName").textContent = currentProfile.name || "A Plus lb";
  $("#dashRole").textContent = `${currentProfile.role} dashboard`;
  $("#dashStatus").textContent = `Status: ${currentProfile.status || "active"}`;
  $("#profileBox").innerHTML = `<strong>Name:</strong> ${safe(currentProfile.name)}<br><strong>Email:</strong> ${safe(currentProfile.email)}<br><strong>Phone:</strong> ${safe(currentProfile.phone)}<br><strong>Role:</strong> ${safe(currentProfile.role)}<br><strong>Status:</strong> ${safe(currentProfile.status || "active")}`;
  document.body.classList.toggle("role-student", currentProfile.role === "student");
  document.body.classList.toggle("role-teacher", currentProfile.role === "teacher");
  document.body.classList.toggle("role-admin", currentProfile.role === "admin");
  $$(".student-only").forEach(x => { x.style.display = currentProfile.role === "student" ? "block" : "none"; });
  $$(".teacher-only").forEach(x => { x.style.display = currentProfile.role === "teacher" ? "block" : "none"; });
  if (currentProfile.role === "student") $("[data-tab='studentUploads']")?.removeAttribute("hidden");
  if (currentProfile.role === "teacher") $("[data-tab='teacherCourses']")?.removeAttribute("hidden");
  loadNotes(); loadCalendar(); loadNotifications(); loadChats();
  if (currentProfile.role === "student") { loadMyEnrollments(); loadStudentSubmissions(); }
  if (currentProfile.role === "teacher") { loadTeacherCourses(); loadTeacherStudents(); }
}

async function notify(uid, title, body) {
  if (!firebaseReady || !uid) return;
  if (uid === "admin") return addDoc(collection(db, "adminNotifications"), { title, body, read: false, createdAt: serverTimestamp(), expiresAt: oneWeekFromNow() });
  return addDoc(collection(db, "users", uid, "notifications"), { title, body, read: false, createdAt: serverTimestamp(), expiresAt: oneWeekFromNow() });
}
async function getUserProfile(uid) { const snap = await getDoc(doc(db, "users", uid)); return snap.exists() ? { uid, ...snap.data() } : null; }

async function loadPublicCourses() {
  const grid = $("#courseGrid");
  if (!grid) return;

  if (!firebaseReady) {
    grid.innerHTML = `<p class="muted">Firebase is not ready. Check firebase-config.js.</p>`;
    return;
  }

  grid.innerHTML = `<p class="muted">Loading courses...</p>`;

  try {
    const snap = await getDocs(query(collection(db, "courses"), where("status", "==", "approved")));

    const rows = [];
    snap.forEach(d => rows.push({ id: d.id, ...d.data() }));

    rows.sort((a, b) => {
      const aPinned = a.pinned === true ? 1 : 0;
      const bPinned = b.pinned === true ? 1 : 0;

      if (aPinned !== bPinned) return bPinned - aPinned;

      const aPinnedAt = a.pinnedAt?.seconds || 0;
      const bPinnedAt = b.pinnedAt?.seconds || 0;

      if (aPinnedAt !== bPinnedAt) return bPinnedAt - aPinnedAt;

      return (b.createdAt?.seconds || b.updatedAt?.seconds || 0) - (a.createdAt?.seconds || a.updatedAt?.seconds || 0);
    });

    const paletteCount = 6;

    grid.innerHTML = rows.length
      ? rows.map((c, index) => `
        <article class="course-card flip-course-card course-palette-${index % paletteCount} ${c.pinned ? "pinned-course" : ""}">
          <div class="flip-card-inner">

            <div class="flip-card-face flip-card-front">
              ${c.pinned ? `<span class="pin-badge">Pinned</span>` : ""}
              <p class="course-front-label">Course</p>
              <h3>${safe(c.title)}</h3>

              <div class="course-front-info">
                <span>${safe(c.category || "General course")}</span>
                <span>Teacher: ${safe(c.teacherName || "Approved teacher")}</span>
              </div>

              <p class="course-hover-hint">Hover / Tap to view details</p>
            </div>

            <div class="flip-card-face flip-card-back">
              <div class="course-back-content">
                <h3>${safe(c.title)}</h3>

                <div class="course-description-scroll">
                  <p>${safe(c.description || "Course details will be shared by the teacher.")}</p>
                </div>

                <div class="course-back-bottom">
                  <span class="course-price-badge">${safe(c.price || "$")}</span>
                  <button type="button" class="primary" data-apply="${safe(c.id)}">Apply to course</button>
                </div>
              </div>
            </div>

          </div>
        </article>
      `).join("")
      : `<p class="muted">No approved courses yet. Teachers can upload courses and the admin approves them first.</p>`;
  } catch (err) {
    console.error(err);
    grid.innerHTML = `<p class="muted">Could not load courses. Check Firestore rules and database setup.</p>`;
  }
}
async function applyToCourse(courseId) {
  if (!requireLogin()) return;
  if (currentProfile.role !== "student") return toast("Only student accounts can apply to courses.");
  try {
    const courseSnap = await getDoc(doc(db, "courses", courseId));
    if (!courseSnap.exists()) return toast("Course not found.");
    const c = courseSnap.data();
    const enrollmentId = `${currentUser.uid}_${courseId}`;
    await setDoc(doc(db, "enrollments", enrollmentId), { courseId, courseTitle: c.title, teacherId: c.teacherId, teacherName: c.teacherName, studentId: currentUser.uid, studentName: currentProfile.name, status: "applied", codeReleased: false, unlocked: false, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });
    await ensureChat(c.teacherId, c.teacherName || "Teacher");
    await notify(c.teacherId, "New student application", `${currentProfile.name} applied to ${c.title}.`);
    await notify("admin", "New course application", `${currentProfile.name} applied to ${c.title}. Confirm payment then release the code.`);
    toast(`Applied. Pay via Whishmoney or OMT to ${PAYMENT_PHONE}, then admin will release your course code.`);
    showDashboard();
  } catch (err) { console.error(err); toast(err); }
}

document.addEventListener("click", e => {
  const goTab = e.target.closest("[data-go-tab]");
  if (goTab) {
    e.preventDefault();
    const targetTab = document.querySelector(`[data-tab="${goTab.dataset.goTab}"]`);
    if (targetTab) targetTab.click();
    return;
  }
  const apply = e.target.closest("[data-apply]"); if (apply) applyToCourse(apply.dataset.apply);
  if (e.target.closest("#refreshCourses")) loadPublicCourses();
  if (e.target.closest("#studentBrowseCourses")) { browseWebsite(); setTimeout(() => document.querySelector("#courses")?.scrollIntoView({behavior:"smooth"}), 80); }
  if (e.target.closest("#browseWebsiteBtn")) browseWebsite();
  if (e.target.closest("#backToDash")) showDashboard();
  if (e.target.closest("#barLogout")) signOut(auth);
});

$$("form[data-auth]").forEach(form => form.addEventListener("submit", async e => {
  e.preventDefault();
  if (!firebaseReady) return toast("Firebase is not ready. Check firebase-config.js.");
  const fd = new FormData(form); const role = form.dataset.role;
  try {
    if (form.dataset.auth === "register") {
      const email = String(fd.get("email")).trim();
      const cred = await createUserWithEmailAndPassword(auth, email, fd.get("password"));
      const acceptedTeacherAgreement = role !== "teacher" || fd.get("teacherAgreement") === "on";
      if (!acceptedTeacherAgreement) return toast("You must accept the teacher agreement before applying.");
      const profile = { uid: cred.user.uid, name: String(fd.get("name") || "").trim(), phone: String(fd.get("phone") || "").trim(), email, role, status: role === "teacher" ? "pending" : "active", contractAccepted: role === "teacher" ? true : false, contractAcceptedAt: role === "teacher" ? serverTimestamp() : null, createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
      await setDoc(doc(db, "users", cred.user.uid), profile, { merge: true });
      if (role === "teacher") await setDoc(doc(db, "teacherApplications", cred.user.uid), { ...profile, experience: String(fd.get("experience") || ""), status: "pending" }, { merge: true });
      toast(role === "teacher" ? "Teacher application sent. Wait for admin approval." : "Student account created.");
      window.aplusCloseModal?.();
    } else {
      await signInWithEmailAndPassword(auth, String(fd.get("email")).trim(), fd.get("password"));
      window.aplusCloseModal?.();
    }
  } catch (err) { console.error(err); toast(err); }
}));

$("#logoutBtn")?.addEventListener("click", () => signOut(auth));
if (firebaseReady) {
  onAuthStateChanged(auth, async user => {
    currentUser = user;
    if (!user) { currentProfile = null; showPublic(false); return; }
    try {
      const snap = await getDoc(doc(db, "users", user.uid));
      if (!snap.exists()) { toast(`Profile not found at users/${user.uid}. Ask admin to check your account.`); await signOut(auth); return; }
      currentProfile = { uid: user.uid, ...snap.data() };
      if (isAdmin()) { showPublic(true); return; }
      if (currentProfile.role === "teacher" && currentProfile.status !== "approved") toast("Your teacher account is pending admin approval.");
      if (new URLSearchParams(location.search).get("browse") === "1") sessionStorage.setItem("aplusBrowsePublic", "1");
      if (sessionStorage.getItem("aplusBrowsePublic") === "1") showPublic(true); else showDashboard();
    } catch (err) { console.error(err); toast(err); }
  });
} else loadPublicCourses();

$("#noteForm")?.addEventListener("submit", async e => { e.preventDefault(); try { await addDoc(collection(db, "users", currentUser.uid, "notes"), { text: $("#noteText").value, done: false, createdAt: serverTimestamp() }); $("#noteText").value = ""; } catch (err) { toast(err); } });
function loadNotes() { const box = $("#notesList"); if (!box) return; live(collection(db, "users", currentUser.uid, "notes"), snap => { const rows = []; snap.forEach(d => rows.push({ id: d.id, ...d.data() })); sortNewest(rows); box.innerHTML = rows.length ? rows.map(n => `<div class="note ${n.done ? "done" : ""}"><p>${safe(n.text)}</p><button type="button" class="ghost" data-note-done="${safe(n.id)}">${n.done ? "Undo" : "Done"}</button> <button type="button" class="danger" data-note-del="${safe(n.id)}">Delete</button></div>`).join("") : `<p class="muted">No notes yet.</p>`; }); }
document.addEventListener("click", async e => { const done = e.target.closest("[data-note-done]"); const del = e.target.closest("[data-note-del]"); try { if (done) { const r = await getDoc(doc(db, "users", currentUser.uid, "notes", done.dataset.noteDone)); await updateDoc(r.ref, { done: !r.data().done }); } if (del) await deleteDoc(doc(db, "users", currentUser.uid, "notes", del.dataset.noteDel)); } catch (err) { toast(err); } });

$("#calendarForm")?.addEventListener("submit", async e => { e.preventDefault(); try { await addDoc(collection(db, "users", currentUser.uid, "calendar"), { title: $("#eventTitle").value, date: $("#eventDate").value, time: $("#eventTime").value, createdAt: serverTimestamp() }); e.target.reset(); } catch (err) { toast(err); } });
function loadCalendar() { const box = $("#calendarList"); if (!box) return; live(collection(db, "users", currentUser.uid, "calendar"), snap => { const rows = []; snap.forEach(d => rows.push({ id: d.id, ...d.data() })); rows.sort((a,b) => String(a.date||"").localeCompare(String(b.date||""))); box.innerHTML = rows.length ? rows.map(ev => `<div class="stack-item"><strong>${safe(ev.title)}</strong><p>${safe(ev.date)} ${safe(ev.time || "")}</p><button type="button" class="danger" data-event-del="${safe(ev.id)}">Delete</button></div>`).join("") : `<p class="muted">No dates saved yet.</p>`; }); }
document.addEventListener("click", async e => { const del = e.target.closest("[data-event-del]"); if (!del) return; try { await deleteDoc(doc(db, "users", currentUser.uid, "calendar", del.dataset.eventDel)); } catch (err) { toast(err); } });

function loadNotifications() {
  const box = $("#notificationsList");
  if (!box) return;
  live(collection(db, "users", currentUser.uid, "notifications"), snap => {
    const rows = [];
    snap.forEach(d => {
      const data = { id: d.id, ...d.data() };
      if (isExpired(data)) deleteDoc(doc(db, "users", currentUser.uid, "notifications", d.id)).catch(console.error);
      else rows.push(data);
    });
    sortNewest(rows);
    box.innerHTML = rows.length
      ? rows.map(n => `<div class="stack-item"><strong>${safe(n.title)}</strong><p>${safe(n.body)}</p></div>`).join("")
      : `<p class="muted">No notifications yet.</p>`;
  });
}

$("#agreeContract")?.addEventListener("click", async () => { try { await updateDoc(doc(db, "users", currentUser.uid), { contractAccepted: true, updatedAt: serverTimestamp() }); currentProfile.contractAccepted = true; toast("Teacher contract accepted."); } catch (err) { toast(err); } });
$("#courseForm")?.addEventListener("submit", async e => {
  e.preventDefault();
  try {
    if (!isTeacherApproved()) return toast("Your teacher account must be approved before adding courses.");
    const data = {
      title: $("#courseTitle").value,
      category: $("#courseCategory").value,
      price: $("#coursePrice").value,
      description: $("#courseDesc").value,
      teacherId: currentUser.uid,
      teacherName: currentProfile.name,
      status: "pending",
      codeReleased: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };
    await addDoc(collection(db, "courses"), data);
    await notify("admin", "New course pending approval", `${currentProfile.name} submitted ${data.title}. Admin must set the private course code before approval.`);
    e.target.reset();
    toast("Course sent for admin approval. Admin will set the private course code.");
  } catch (err) { console.error(err); toast(err); }
});
async function renderTeacherCourses(rows, list, select) {
  select.innerHTML = rows.length ? rows.map(c => `<option value="${safe(c.id)}">${safe(c.title)} (${safe(c.status)})</option>`).join("") : `<option value="">No courses yet</option>`;
  if (!rows.length) {
    list.innerHTML = `<p class="muted">No courses yet.</p>`;
    return;
  }
  const cards = await Promise.all(rows.map(async c => {
    const itemSnap = await getDocs(collection(db, "courses", c.id, "items"));
    const items = [];
    itemSnap.forEach(d => items.push({ id: d.id, ...d.data() }));
    sortNewest(items);
    const itemsHtml = items.length
      ? `<div class="teacher-item-list">${items.map(item => `
          <div class="teacher-item">
            <div class="teacher-item-copy">
              <strong>${safe(item.title)}</strong>
              <span class="tag">${safe(item.type || "material")}</span>
              <p>${safe(item.description || "No description.")}</p>
              ${item.fileUrl ? `<a class="ghost small" href="${safe(item.fileUrl)}" target="_blank" rel="noopener">Open ${safe(item.fileName || "file")}</a>` : `<span class="muted">No file attached.</span>`}
            </div>
            <div class="teacher-item-actions">
              <button type="button" class="ghost small" data-edit-item="${safe(item.id)}" data-course-id="${safe(c.id)}">Edit item</button>
              <button type="button" class="danger small" data-delete-item="${safe(item.id)}" data-course-id="${safe(c.id)}">Delete item</button>
            </div>
          </div>`).join("")}</div>`
      : `<p class="muted">No uploaded items yet for this course.</p>`;
    return `<div class="stack-item course-manage-card">
      <div class="course-manage-head">
        <div>
          <strong>${safe(c.title)}</strong> <span class="tag">${safe(c.status)}</span>
          <p>${safe(c.description)}</p>
          <p><strong>Category:</strong> ${safe(c.category)} | <strong>Price:</strong> ${safe(c.price)}</p>
        </div>
        <div class="teacher-course-actions">
          <button type="button" class="ghost small" data-edit-course="${safe(c.id)}">Edit course</button>
          <button type="button" class="danger small" disabled title="Disabled for safety">Delete disabled</button>
        </div>
      </div>
      <div class="course-item-block">
        <h3>Uploaded items</h3>
        ${itemsHtml}
      </div>
    </div>`;
  }));
  list.innerHTML = cards.join("");
}
function loadTeacherCourses() {
  const list = $("#teacherCoursesList"), select = $("#materialCourse");
  if (!list || !select) return;
  live(query(collection(db, "courses"), where("teacherId", "==", currentUser.uid)), async snap => {
    const rows = [];
    snap.forEach(d => rows.push({ id: d.id, ...d.data() }));
    sortNewest(rows);
    await renderTeacherCourses(rows, list, select);
  });
}
$("#materialForm")?.addEventListener("submit", async e => { e.preventDefault(); try { if (!isTeacherApproved()) return toast("Your teacher account must be approved before adding materials."); const courseId = $("#materialCourse").value; if (!courseId) return toast("Create a course first."); let fileUrl = "", fileName = ""; const file = $("#materialFile").files[0]; if (file) { if (!isPdfOrZip(file)) return toast("Only PDF or ZIP files are allowed."); const cleanName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_"); const path = `courseMaterials/${currentUser.uid}/${courseId}/${Date.now()}-${cleanName}`; const upload = await uploadBytes(ref(storage, path), file); fileUrl = await getDownloadURL(upload.ref); fileName = file.name; } await addDoc(collection(db, "courses", courseId, "items"), { type: $("#materialType").value, title: $("#materialTitle").value, description: $("#materialDesc").value, fileUrl, fileName, teacherId: currentUser.uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }); await updateDoc(doc(db, "courses", courseId), { updatedAt: serverTimestamp() }); await notify("admin", "Course item added", `${currentProfile.name} added ${$("#materialType").value}: ${$("#materialTitle").value}`); e.target.reset(); toast("Added to course."); } catch (err) { console.error(err); toast(err); } });
async function editTeacherCourse(courseId) {
  try {
    const snap = await getDoc(doc(db, "courses", courseId));
    if (!snap.exists()) return toast("Course not found.");
    const data = snap.data();
    const title = prompt("Edit course title:", data.title || "");
    if (title === null) return;
    const category = prompt("Edit course category:", data.category || "");
    if (category === null) return;
    const price = prompt("Edit course price:", data.price || "");
    if (price === null) return;
    const description = prompt("Edit course description:", data.description || "");
    if (description === null) return;
    await updateDoc(doc(db, "courses", courseId), {
      title: title.trim(),
      category: category.trim(),
      price: price.trim(),
      description: description.trim(),
      updatedAt: serverTimestamp()
    });
    toast("Course updated.");
  } catch (err) { console.error(err); toast(err); }
}
async function deleteTeacherCourse(courseId) {
  toast("Course deletion is disabled for safety. Please ask the admin to remove or archive courses manually.");
}
async function editTeacherItem(courseId, itemId) {
  try {
    const snap = await getDoc(doc(db, "courses", courseId, "items", itemId));
    if (!snap.exists()) return toast("Item not found.");
    const data = snap.data();
    const title = prompt("Edit item title:", data.title || "");
    if (title === null) return;
    const type = prompt("Edit item type (material / session / task / exam / test):", data.type || "material");
    if (type === null) return;
    const description = prompt("Edit item description:", data.description || "");
    if (description === null) return;
    await updateDoc(doc(db, "courses", courseId, "items", itemId), {
      title: title.trim(),
      type: type.trim() || "material",
      description: description.trim(),
      updatedAt: serverTimestamp()
    });
    await updateDoc(doc(db, "courses", courseId), { updatedAt: serverTimestamp() });
    toast("Item updated. To replace a file, delete the item and upload it again.");
  } catch (err) { console.error(err); toast(err); }
}
async function deleteTeacherItem(courseId, itemId) {
  try {
    if (!confirm("Delete this uploaded item?")) return;
    await deleteDoc(doc(db, "courses", courseId, "items", itemId));
    await updateDoc(doc(db, "courses", courseId), { updatedAt: serverTimestamp() });
    toast("Item deleted.");
  } catch (err) { console.error(err); toast(err); }
}
document.addEventListener("click", async e => {
  const editCourseBtn = e.target.closest("[data-edit-course]");
  const deleteCourseBtn = e.target.closest("[data-delete-course]");
  const editItemBtn = e.target.closest("[data-edit-item]");
  const deleteItemBtn = e.target.closest("[data-delete-item]");
  if (editCourseBtn) return editTeacherCourse(editCourseBtn.dataset.editCourse);
  if (deleteCourseBtn) return deleteTeacherCourse(deleteCourseBtn.dataset.deleteCourse);
  if (editItemBtn) return editTeacherItem(editItemBtn.dataset.courseId, editItemBtn.dataset.editItem);
  if (deleteItemBtn) return deleteTeacherItem(deleteItemBtn.dataset.courseId, deleteItemBtn.dataset.deleteItem);
});

function loadTeacherStudents() { const box = $("#teacherStudentsList"); if (!box) return; live(query(collection(db, "enrollments"), where("teacherId", "==", currentUser.uid)), snap => { const rows = []; snap.forEach(d => rows.push({ id: d.id, ...d.data() })); sortNewest(rows); box.innerHTML = rows.length ? rows.map(e => `<div class="stack-item"><strong>${safe(e.studentName)}</strong><p>Course: ${safe(e.courseTitle)}</p><button type="button" class="primary" data-chat-user="${safe(e.studentId)}" data-chat-name="${safe(e.studentName)}">Chat 1 on 1</button></div>`).join("") : `<p class="muted">No enrolled students yet.</p>`; }); }

function loadMyEnrollments() {
  const box = $("#myEnrollments"), select = $("#submissionCourse");
  if (!box || !select) return;
  live(query(collection(db, "enrollments"), where("studentId", "==", currentUser.uid)), snap => {
    const rows = [];
    snap.forEach(d => rows.push({ id: d.id, ...d.data() }));
    sortNewest(rows);
    const unlockedRows = rows.filter(e => e.unlocked === true || e.access === "unlocked" || e.status === "unlocked");
    select.innerHTML = unlockedRows.length
      ? unlockedRows.map(e => `<option value="${safe(e.courseId)}" data-title="${safe(e.courseTitle)}">${safe(e.courseTitle)}</option>`).join("")
      : `<option value="">No unlocked courses yet</option>`;
    box.innerHTML = rows.length ? rows.map(e => {
      const isUnlocked = e.unlocked === true || e.access === "unlocked" || e.status === "unlocked";
      return `<div class="stack-item"><strong>${safe(e.courseTitle)}</strong><p>Status: ${safe(e.status)}<br>Code released: ${e.codeReleased ? "Yes" : "No"}<br>Unlocked: ${isUnlocked ? "Yes" : "No"}</p>${isUnlocked ? `<span class="tag">Materials unlocked</span>` : `<div class="inline-form"><input id="unlock-${safe(e.id)}" placeholder="Enter admin course code"><button type="button" class="primary" data-unlock="${safe(e.id)}" data-course="${safe(e.courseId)}">Unlock</button></div>`}<button type="button" class="ghost" data-chat-user="${safe(e.teacherId)}" data-chat-name="${safe(e.teacherName)}">Chat with teacher</button></div>`;
    }).join("") : `<p class="muted">No enrolled courses yet.</p>`;
    loadStudentMaterials(unlockedRows);
  });
}

async function loadStudentMaterials(enrollments = []) {
  const box = $("#studentMaterials");
  if (!box) return;
  if (!enrollments.length) {
    box.innerHTML = `<p class="muted">No unlocked course materials yet. Apply, pay, receive the admin code, then unlock your course.</p>`;
    return;
  }
  box.innerHTML = `<p class="muted">Loading materials...</p>`;
  try {
    const all = [];
    for (const e of enrollments) {
      const snap = await getDocs(collection(db, "courses", e.courseId, "items"));
      snap.forEach(d => all.push({ id: d.id, courseTitle: e.courseTitle, ...d.data() }));
    }
    sortNewest(all);
    box.innerHTML = all.length ? all.map(item => `<div class="stack-item"><strong>${safe(item.title)}</strong> <span class="tag">${safe(item.type || "material")}</span><p><strong>Course:</strong> ${safe(item.courseTitle)}<br>${safe(item.description || "")}</p>${item.fileUrl ? `<a class="primary small" href="${safe(item.fileUrl)}" target="_blank" rel="noopener">Open / Download ${safe(item.fileName || "file")}</a>` : `<span class="muted">No file attached.</span>`}</div>`).join("") : `<p class="muted">Your teacher has not uploaded materials for your unlocked courses yet.</p>`;
  } catch (err) {
    console.error(err);
    box.innerHTML = `<p class="muted">Could not load materials. Check Firestore rules for courses/items.</p>`;
  }
}

document.addEventListener("click", async e => { const btn = e.target.closest("[data-unlock]"); if (!btn) return; try { const enrollmentId = btn.dataset.unlock; const courseId = btn.dataset.course; const input = $(`#unlock-${CSS.escape(enrollmentId)}`); const code = input?.value?.trim(); if (!code) return toast("Enter the course code first."); const enr = await getDoc(doc(db, "enrollments", enrollmentId)); if (!enr.exists()) return toast("Enrollment not found."); if (!enr.data().codeReleased) return toast("Admin has not released this code yet after payment confirmation."); const c = await getDoc(doc(db, "courses", courseId)); if (!c.exists()) return toast("Course not found."); if (!c.data().code) return toast("Admin has not set a code for this course yet."); if (String(c.data().code).trim() !== code) return toast("Wrong course code."); await updateDoc(doc(db, "enrollments", enrollmentId), { unlocked: true, access: "unlocked", status: "unlocked", updatedAt: serverTimestamp() }); toast("Course unlocked successfully. Materials are now available."); } catch (err) { console.error(err); toast(err); } });
$("#submissionForm")?.addEventListener("submit", async e => { e.preventDefault(); try { const file = $("#submissionFile").files[0]; if (!file) return toast("Choose a PDF or ZIP file."); if (!isPdfOrZip(file)) return toast("Only PDF or ZIP files are allowed."); const courseId = $("#submissionCourse").value; if (!courseId) return toast("Choose a course first."); const selected = $("#submissionCourse").selectedOptions[0]; const cleanName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_"); const path = `studentSubmissions/${currentUser.uid}/${courseId}/${Date.now()}-${cleanName}`; const upload = await uploadBytes(ref(storage, path), file); const fileUrl = await getDownloadURL(upload.ref); await addDoc(collection(db, "submissions"), { studentId: currentUser.uid, studentName: currentProfile.name, courseId, courseTitle: selected?.textContent || "Course", title: $("#submissionTitle").value, fileName: file.name, fileUrl, createdAt: serverTimestamp() }); await notify("admin", "New student submission", `${currentProfile.name} uploaded ${$("#submissionTitle").value}.`); e.target.reset(); toast("Submission uploaded."); } catch (err) { console.error(err); toast(err); } });
function loadStudentSubmissions() { const box = $("#studentSubmissions"); if (!box) return; live(query(collection(db, "submissions"), where("studentId", "==", currentUser.uid)), snap => { const rows = []; snap.forEach(d => rows.push({ id: d.id, ...d.data() })); sortNewest(rows); box.innerHTML = rows.length ? rows.map(s => `<div class="stack-item"><strong>${safe(s.title)}</strong><p>${safe(s.courseTitle || "")}<br>${safe(s.fileName)}</p><a class="ghost" href="${safe(s.fileUrl)}" target="_blank" rel="noopener">Open file</a></div>`).join("") : `<p class="muted">No submissions yet.</p>`; }); }

function chatIdFor(otherUid) { return [currentUser.uid, otherUid].sort().join("_"); }
async function ensureChat(otherUid, otherName = "User") { const id = chatIdFor(otherUid); await setDoc(doc(db, "chats", id), { participants: [currentUser.uid, otherUid], updatedAt: serverTimestamp(), names: { [currentUser.uid]: currentProfile?.name || "Me", [otherUid]: otherName } }, { merge: true }); return id; }
async function openChat(otherUid, otherName = "User") { activeChatName = otherName; activeChatId = await ensureChat(otherUid, otherName); $("#chatBox")?.classList.remove("hidden"); $("#chatList").innerHTML = `<div class="stack-item active-chat"><strong>Now chatting with ${safe(activeChatName)}</strong><p class="muted">Messages update live.</p></div>`; document.querySelector('[data-tab="chat"]')?.click(); loadMessages(); }
document.addEventListener("click", async e => { const btn = e.target.closest("[data-chat-user]"); if (!btn) return; try { await openChat(btn.dataset.chatUser, btn.dataset.chatName || "User"); } catch (err) { console.error(err); toast(err); } });
function loadChats() { const list = $("#chatList"); if (!list || !currentUser) return; live(query(collection(db, "chats"), where("participants", "array-contains", currentUser.uid)), snap => { const rows = []; snap.forEach(d => rows.push({ id: d.id, ...d.data() })); sortNewest(rows); if (!rows.length) { list.innerHTML = `<p class="muted">No chats yet. Use the chat buttons in your courses or students section.</p>`; return; } list.innerHTML = `<div class="chat-user-list">${rows.map(c => { const other = (c.participants || []).find(uid => uid !== currentUser.uid) || ""; const name = c.names?.[other] || "User"; return `<button type="button" class="chat-person" data-chat-user="${safe(other)}" data-chat-name="${safe(name)}"><strong>${safe(name)}</strong><span>${safe(c.lastMessage || "Open conversation")}</span></button>`; }).join("")}</div>`; }); }
function loadMessages() { const box = $("#messages"); if (!box || !activeChatId) return; if (messageUnsub) messageUnsub(); messageUnsub = onSnapshot(collection(db, "chats", activeChatId, "messages"), snap => { const rows = []; snap.forEach(d => rows.push({ id: d.id, ...d.data() })); sortNewest(rows); rows.reverse(); box.innerHTML = rows.length ? rows.map(m => `<div class="msg ${m.senderId === currentUser.uid ? "mine" : ""}"><strong>${safe(m.senderName || "")}</strong><br>${safe(m.text)}</div>`).join("") : `<p class="muted">No messages yet. Start the conversation.</p>`; box.scrollTop = box.scrollHeight; }, err => toast(err)); }
$("#messageForm")?.addEventListener("submit", async e => { e.preventDefault(); if (!activeChatId) return toast("Choose a chat first."); try { const text = $("#messageText").value.trim(); if (!text) return; await addDoc(collection(db, "chats", activeChatId, "messages"), { text, senderId: currentUser.uid, senderName: currentProfile.name, createdAt: serverTimestamp() }); await updateDoc(doc(db, "chats", activeChatId), { lastMessage: text, updatedAt: serverTimestamp() }); $("#messageText").value = ""; } catch (err) { console.error(err); toast(err); } });

/* ===== V10.2 MOBILE TAP FLIP FIX ===== */
document.addEventListener("click", (e) => {
  const card = e.target.closest(".flip-course-card");
  if (!card) return;

  const clickedAction = e.target.closest("button, a, input, textarea, select");
  if (clickedAction) return;

  card.classList.toggle("is-flipped");
});
