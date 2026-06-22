import { initializeApp } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, collection, query, where, onSnapshot, getDocs, updateDoc, addDoc, serverTimestamp, Timestamp, deleteDoc } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const $ = (s) => document.querySelector(s);
const safe = (v) => window.aplusSafe ? window.aplusSafe(v) : String(v ?? "");
const toast = (m) => window.aplusToast ? window.aplusToast(cleanFirebaseError(m), 6000) : alert(cleanFirebaseError(m));

let app, auth, db;
let adminUser = null;
let adminProfile = null;
let activeChatId = null;
let activeChatName = "";
let unsubs = [];
let messageUnsub = null;
let firebaseReady = false;

try {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  firebaseReady = true;
} catch (error) {
  console.error("Firebase init error", error);
  toast("Firebase config error. Check assets/js/firebase-config.js");
}

function cleanFirebaseError(error) {
  const msg = typeof error === "string" ? error : (error?.message || "Something went wrong.");
  return msg.replace("Firebase: ", "").replace(/\s*\((auth|firestore)\/.*?\)\.?/g, "");
}
function stopLive() { unsubs.forEach(fn => typeof fn === "function" && fn()); unsubs = []; if (messageUnsub) { messageUnsub(); messageUnsub = null; } }
function live(q, cb) { const off = onSnapshot(q, cb, err => { console.error(err); toast(err); }); unsubs.push(off); return off; }
function sortNewest(rows) { return rows.sort((a,b) => (b.createdAt?.seconds || b.updatedAt?.seconds || 0) - (a.createdAt?.seconds || a.updatedAt?.seconds || 0)); }
function oneWeekFromNow() { return Timestamp.fromDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)); }
function isExpired(docData) {
  const seconds = docData?.expiresAt?.seconds || docData?.createdAt?.seconds;
  return seconds ? seconds < Math.floor(Date.now() / 1000) - (7 * 24 * 60 * 60) : false;
}
function statusPill(status) { return `<span class="status-pill status-${safe(status || "unknown")}">${safe(status || "unknown")}</span>`; }
function showLogin() { stopLive(); $("#adminLogin")?.classList.remove("hidden"); $("#adminDashboard")?.classList.add("hidden"); }
function showDashboard() { $("#adminLogin")?.classList.add("hidden"); $("#adminDashboard")?.classList.remove("hidden"); loadUsers(); loadApplications(); loadCourses(); loadAllCourses(); loadEnrollments(); loadAdminChatUsers(); loadAdminNotifications(); }
async function notify(uid, title, body) { if (!uid) return; return addDoc(collection(db, "users", uid, "notifications"), { title, body, read: false, createdAt: serverTimestamp(), expiresAt: oneWeekFromNow() }); }

$("#adminLoginForm")?.addEventListener("submit", async e => {
  e.preventDefault();
  if (!firebaseReady) return toast("Firebase is not ready. Check firebase-config.js.");
  try { await signInWithEmailAndPassword(auth, $("#adminEmail").value.trim(), $("#adminPassword").value); }
  catch (err) { console.error(err); toast(err); }
});
$("#adminLogout")?.addEventListener("click", () => signOut(auth));

if (firebaseReady) {
  onAuthStateChanged(auth, async user => {
    adminUser = user;
    if (!user) return showLogin();
    try {
      const snap = await getDoc(doc(db, "users", user.uid));
      adminProfile = snap.exists() ? { uid: user.uid, ...snap.data() } : null;
      if (!adminProfile || adminProfile.role !== "admin" || adminProfile.status !== "approved") {
        toast(`Access denied. Firestore must contain users/${user.uid} with role=admin and status=approved.`);
        await signOut(auth);
        return;
      }
      showDashboard();
    } catch (err) { console.error(err); toast(err); showLogin(); }
  });
}

function loadUsers() {
  const box = $("#adminUsers"); if (!box) return;
  live(collection(db, "users"), snap => {
    const rows = []; snap.forEach(d => rows.push({ id: d.id, ...d.data() })); sortNewest(rows);
    box.innerHTML = rows.length ? `<table class="data-table"><thead><tr><th>Name</th><th>Phone</th><th>Email</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead><tbody>${rows.map(u => {
      const teacherActions = u.role === "teacher" && u.status !== "approved" ? ` <button type="button" class="primary small" data-set-user-status="${safe(u.id)}" data-status="approved">Approve</button>` : "";
      const rejectAction = u.role === "teacher" && u.status !== "rejected" ? ` <button type="button" class="danger small" data-set-user-status="${safe(u.id)}" data-status="rejected">Reject</button>` : "";
      return `<tr><td>${safe(u.name)}</td><td>${safe(u.phone)}</td><td>${safe(u.email)}</td><td>${safe(u.role)}</td><td>${statusPill(u.status)}</td><td><button type="button" class="ghost small" data-admin-chat="${safe(u.id)}" data-chat-name="${safe(u.name || u.email)}">Chat</button>${teacherActions}${rejectAction}</td></tr>`;
    }).join("")}</tbody></table>` : `<p class="muted">No users yet.</p>`;
  });
}
function loadApplications() {
  const box = $("#teacherApplications"); if (!box) return;
  live(collection(db, "teacherApplications"), snap => {
    const rows = []; snap.forEach(d => rows.push({ id: d.id, ...d.data() })); sortNewest(rows);
    const pending = rows.filter(a => (a.status || "pending") === "pending");
    box.innerHTML = pending.length ? pending.map(a => `<div class="stack-item"><strong>${safe(a.name)}</strong> ${statusPill(a.status || "pending")}<p>${safe(a.email)} | ${safe(a.phone)}</p><p>${safe(a.experience)}</p><button type="button" class="primary" data-approve-teacher="${safe(a.uid || a.id)}" data-app-id="${safe(a.id)}">Approve</button> <button type="button" class="danger" data-reject-teacher="${safe(a.uid || a.id)}" data-app-id="${safe(a.id)}">Reject</button> <button type="button" class="ghost" data-admin-chat="${safe(a.uid || a.id)}" data-chat-name="${safe(a.name)}">Chat</button></div>`).join("") : `<p class="muted">No pending teacher applications.</p>`;
  });
}
async function setTeacherStatus(uid, appId, status) {
  try {
    const appSnap = await getDoc(doc(db, "teacherApplications", appId || uid));
    const a = appSnap.exists() ? appSnap.data() : {};
    await setDoc(doc(db, "users", uid), { uid, name: a.name || "Teacher", phone: a.phone || "", email: a.email || "", role: "teacher", status, contractAccepted: a.contractAccepted || false, updatedAt: serverTimestamp() }, { merge: true });
    await setDoc(doc(db, "teacherApplications", appId || uid), { status, updatedAt: serverTimestamp() }, { merge: true });
    await notify(uid, `Teacher application ${status}`, status === "approved" ? "You can now add courses. Courses still need admin approval before public display." : "Your teacher application was rejected.");
    toast(`Teacher ${status}.`);
  } catch (err) { console.error(err); toast(err); }
}
async function setUserStatus(uid, status) { try { await updateDoc(doc(db, "users", uid), { status, updatedAt: serverTimestamp() }); await notify(uid, `Account ${status}`, `Your A Plus lb account status is now ${status}.`); toast(`User ${status}.`); } catch (err) { console.error(err); toast(err); } }

function loadCourses() {
  const box = $("#pendingCourses"); if (!box) return;
  live(collection(db, "courses"), snap => {
    const rows = []; snap.forEach(d => rows.push({ id: d.id, ...d.data() })); sortNewest(rows);
    const pending = rows.filter(c => (c.status || "pending") === "pending");
    box.innerHTML = pending.length ? pending.map(c => `<div class="stack-item"><strong>${safe(c.title)}</strong> <span class="tag">${safe(c.price)}</span> ${statusPill(c.status)}<p>${safe(c.description)}</p><p>Teacher: ${safe(c.teacherName)} | Category: ${safe(c.category)}</p><input id="admin-code-${safe(c.id)}" placeholder="Set private course code (admin only)" required><button type="button" class="primary" data-approve-course="${safe(c.id)}" data-teacher="${safe(c.teacherId)}">Approve course with code</button> <button type="button" class="danger" data-reject-course="${safe(c.id)}" data-teacher="${safe(c.teacherId)}">Reject</button> <button type="button" class="ghost" data-admin-chat="${safe(c.teacherId)}" data-chat-name="${safe(c.teacherName)}">Chat teacher</button></div>`).join("") : `<p class="muted">No pending courses. Approved/rejected courses are hidden from this approval queue.</p>`;
  });
}

function loadAllCourses() {
  const box = $("#allCoursesAdmin");
  if (!box) return;

  live(collection(db, "courses"), snap => {
    const rows = [];
    snap.forEach(d => rows.push({ id: d.id, ...d.data() }));

    rows.sort((a, b) => {
      const pinnedDiff = (b.pinned === true ? 1 : 0) - (a.pinned === true ? 1 : 0);
      if (pinnedDiff) return pinnedDiff;
      const pinTimeDiff = (b.pinnedAt?.seconds || 0) - (a.pinnedAt?.seconds || 0);
      if (pinTimeDiff) return pinTimeDiff;
      return (b.createdAt?.seconds || b.updatedAt?.seconds || 0) - (a.createdAt?.seconds || a.updatedAt?.seconds || 0);
    });

    box.innerHTML = rows.length
      ? rows.map(c => {
          const pinAction = c.pinned === true
            ? `<button type="button" class="danger small" data-pin-course="${safe(c.id)}" data-pin-state="false">Unpin course</button>`
            : `<button type="button" class="primary small" data-pin-course="${safe(c.id)}" data-pin-state="true">Pin course</button>`;

          const pinnedLabel = c.pinned === true ? `<span class="pin-badge admin-pin">Pinned on website</span>` : `<span class="tag">Not pinned</span>`;

          return `<div class="stack-item admin-course-row">
            <div class="admin-course-copy">
              <strong>${safe(c.title)}</strong> ${statusPill(c.status || "unknown")} ${pinnedLabel}
              <p>${safe(c.description || "No description.")}</p>
              <p><strong>Teacher:</strong> ${safe(c.teacherName || "Teacher")} | <strong>Category:</strong> ${safe(c.category || "-")} | <strong>Price:</strong> ${safe(c.price || "-")}</p>
            </div>
            <div class="admin-course-actions">
              ${pinAction}
              <button type="button" class="ghost small" data-admin-chat="${safe(c.teacherId || "")}" data-chat-name="${safe(c.teacherName || "Teacher")}">Chat teacher</button>
            </div>
          </div>`;
        }).join("")
      : `<p class="muted">No courses yet.</p>`;
  });
}

async function setCoursePin(courseId, shouldPin) {
  try {
    if (!courseId) return toast("Course ID missing. Refresh and try again.");
    const courseRef = doc(db, "courses", courseId);
    const snap = await getDoc(courseRef);
    if (!snap.exists()) return toast("Course not found.");

    await updateDoc(courseRef, {
      pinned: shouldPin === true,
      pinnedAt: shouldPin === true ? serverTimestamp() : null,
      pinnedBy: shouldPin === true ? adminUser.uid : null,
      updatedAt: serverTimestamp()
    });

    toast(shouldPin ? "Course pinned. It will appear first on the website." : "Course unpinned.");
  } catch (err) {
    console.error(err);
    toast(err);
  }
}

async function setCourseStatus(id, teacherId, status, adminCode = "") {
  try {
    const c = await getDoc(doc(db, "courses", id));
    if (!c.exists()) return toast("Course not found.");
    const update = { status, updatedAt: serverTimestamp() };
    if (status === "approved") {
      const code = String(adminCode || "").trim();
      if (!code) return toast("Set the private course code before approving. Only admin can set it.");
      update.code = code;
      update.codeSetBy = adminUser.uid;
      update.codeSetAt = serverTimestamp();
    }
    await updateDoc(doc(db, "courses", id), update);
    if (teacherId) await notify(teacherId, `Course ${status}`, `${c.data()?.title || "Your course"} was ${status} by admin.${status === "approved" ? " The private course code was set by admin." : ""}`);
    toast(`Course ${status}.`);
  } catch (err) { console.error(err); toast(err); }
}
function loadEnrollments() {
  const box = $("#adminEnrollments"); if (!box) return;
  live(collection(db, "enrollments"), snap => {
    const rows = []; snap.forEach(d => rows.push({ id: d.id, ...d.data() })); sortNewest(rows);
    box.innerHTML = rows.length ? rows.map(e => `<div class="stack-item"><strong>${safe(e.studentName)}</strong> ${statusPill(e.status)}<p>Course: ${safe(e.courseTitle)}<br>Teacher: ${safe(e.teacherName)}<br>Code released: ${e.codeReleased ? "Yes" : "No"} | Unlocked: ${e.unlocked ? "Yes" : "No"}</p>${e.codeReleased ? `<span class="tag">Code already released</span>` : `<button type="button" class="primary" data-release-code="${safe(e.id)}" data-student="${safe(e.studentId)}" data-course="${safe(e.courseId)}">Release course code</button>`} <button type="button" class="ghost" data-admin-chat="${safe(e.studentId)}" data-chat-name="${safe(e.studentName)}">Chat student</button> <button type="button" class="ghost" data-admin-chat="${safe(e.teacherId)}" data-chat-name="${safe(e.teacherName)}">Chat teacher</button> <button type="button" class="danger" data-kick-student="${safe(e.id)}" data-student="${safe(e.studentId)}" data-course="${safe(e.courseId)}" data-teacher="${safe(e.teacherId)}" data-student-name="${safe(e.studentName)}" data-course-title="${safe(e.courseTitle)}">Kick out student</button><p class="kick-student-note">This removes only this course enrollment, not the student account.</p></div>`).join("") : `<p class="muted">No enrollments yet.</p>`;
  });
}
async function releaseCode(enrollmentId, studentId, courseId) {
  try {
    const course = await getDoc(doc(db, "courses", courseId));
    if (!course.exists()) return toast("Course not found.");
    let code = String(course.data().code || "").trim();
    if (!code) {
      code = prompt("This approved course has no code yet. Set the private admin course code now:");
      if (!code || !code.trim()) return toast("Course code is required before release.");
      code = code.trim();
      await updateDoc(doc(db, "courses", courseId), { code, codeSetBy: adminUser.uid, codeSetAt: serverTimestamp(), updatedAt: serverTimestamp() });
    }
    await updateDoc(doc(db, "enrollments", enrollmentId), { codeReleased: true, status: "code released", updatedAt: serverTimestamp() });
    await notify(studentId, "Course code released", `Payment confirmed. Your code for ${course.data().title} is: ${code}`);
    toast("Code released to student notification.");
  } catch (err) { console.error(err); toast(err); }
}

async function kickOutStudent(enrollmentId, studentId, courseId, teacherId, studentName = "Student", courseTitle = "course") {
  try {
    if (!enrollmentId || !studentId || !courseId) return toast("Missing enrollment details. Refresh and try again.");
    const confirmed = confirm(`Kick out ${studentName || "this student"} from ${courseTitle || "this course"}? This removes the student enrollment and related submissions for this course.`);
    if (!confirmed) return;

    const submissionsQuery = query(collection(db, "submissions"), where("studentId", "==", studentId), where("courseId", "==", courseId));
    const submissionsSnap = await getDocs(submissionsQuery);
    const deletes = [];
    submissionsSnap.forEach(s => deletes.push(deleteDoc(doc(db, "submissions", s.id))));
    await Promise.all(deletes);

    await deleteDoc(doc(db, "enrollments", enrollmentId));
    await notify(studentId, "Removed from course", `You were removed from ${courseTitle || "a course"} by A Plus lb admin. Contact support if you think this is a mistake.`);
    if (teacherId) await notify(teacherId, "Student removed", `${studentName || "A student"} was removed from ${courseTitle || "your course"} by admin.`);
    toast("Student kicked out from this course.");
  } catch (err) { console.error(err); toast(err); }
}

document.addEventListener("click", e => {
  const approveTeacher = e.target.closest("[data-approve-teacher]");
  const rejectTeacher = e.target.closest("[data-reject-teacher]");
  const approveCourse = e.target.closest("[data-approve-course]");
  const rejectCourse = e.target.closest("[data-reject-course]");
  const release = e.target.closest("[data-release-code]");
  const statusBtn = e.target.closest("[data-set-user-status]");
  const chatBtn = e.target.closest("[data-admin-chat]");
  const kickBtn = e.target.closest("[data-kick-student]");
  const pinBtn = e.target.closest("[data-pin-course]");
  if (approveTeacher) setTeacherStatus(approveTeacher.dataset.approveTeacher, approveTeacher.dataset.appId, "approved");
  if (rejectTeacher) setTeacherStatus(rejectTeacher.dataset.rejectTeacher, rejectTeacher.dataset.appId, "rejected");
  if (approveCourse) {
    const id = approveCourse.dataset.approveCourse;
    const code = document.getElementById(`admin-code-${id}`)?.value || "";
    setCourseStatus(id, approveCourse.dataset.teacher, "approved", code);
  }
  if (rejectCourse) setCourseStatus(rejectCourse.dataset.rejectCourse, rejectCourse.dataset.teacher, "rejected");
  if (release) releaseCode(release.dataset.releaseCode, release.dataset.student, release.dataset.course);
  if (statusBtn) setUserStatus(statusBtn.dataset.setUserStatus, statusBtn.dataset.status);
  if (chatBtn) openAdminChat(chatBtn.dataset.adminChat, chatBtn.dataset.chatName || "User");
  if (kickBtn) kickOutStudent(kickBtn.dataset.kickStudent, kickBtn.dataset.student, kickBtn.dataset.course, kickBtn.dataset.teacher, kickBtn.dataset.studentName, kickBtn.dataset.courseTitle);
  if (pinBtn) setCoursePin(pinBtn.dataset.pinCourse, pinBtn.dataset.pinState === "true");
});

$("#adminNotifyForm")?.addEventListener("submit", async e => {
  e.preventDefault();
  try {
    const target = $("#notifyTarget").value, title = $("#notifyTitle").value, body = $("#notifyBody").value;
    const q = target === "all" ? collection(db, "users") : query(collection(db, "users"), where("role", "==", target === "students" ? "student" : "teacher"));
    const snap = await getDocs(q);
    const writes = []; snap.forEach(d => writes.push(notify(d.id, title, body)));
    await Promise.all(writes); e.target.reset(); toast("Notification sent.");
  } catch (err) { console.error(err); toast(err); }
});

function loadAdminNotifications() {
  live(collection(db, "adminNotifications"), snap => {
    snap.forEach(d => {
      const data = { id: d.id, ...d.data() };
      if (isExpired(data)) deleteDoc(doc(db, "adminNotifications", d.id)).catch(console.error);
    });
  });
}
function loadAdminChatUsers() {
  const box = $("#adminChatUsers"); if (!box) return;
  live(collection(db, "users"), snap => {
    const rows = []; snap.forEach(d => { if (d.id !== adminUser.uid) rows.push({ id: d.id, ...d.data() }); }); sortNewest(rows);
    box.innerHTML = rows.length ? `<div class="chat-user-list">${rows.map(u => `<button type="button" class="chat-person" data-admin-chat="${safe(u.id)}" data-chat-name="${safe(u.name || u.email)}"><strong>${safe(u.name || u.email)}</strong><span>${safe(u.role)} • ${safe(u.status)}</span></button>`).join("")}</div>` : `<p class="muted">No users to chat with yet.</p>`;
  });
}
function chatIdFor(otherUid) { return [adminUser.uid, otherUid].sort().join("_"); }
async function openAdminChat(otherUid, name) {
  try {
    activeChatName = name || "User";
    activeChatId = chatIdFor(otherUid);
    await setDoc(doc(db, "chats", activeChatId), { participants: [adminUser.uid, otherUid], updatedAt: serverTimestamp(), names: { [adminUser.uid]: adminProfile?.name || "Admin", [otherUid]: activeChatName } }, { merge: true });
    $("#adminChatBox")?.classList.remove("hidden");
    $("#adminChatTitle").innerHTML = `<strong>Chat with ${safe(activeChatName)}</strong><p class="muted">Messages update live.</p>`;
    document.querySelector('[data-admin-tab="chat"]')?.click();
    loadAdminMessages();
  } catch (err) { console.error(err); toast(err); }
}
function loadAdminMessages() {
  const box = $("#adminMessages"); if (!box || !activeChatId) return;
  if (messageUnsub) messageUnsub();
  messageUnsub = onSnapshot(collection(db, "chats", activeChatId, "messages"), snap => {
    const rows = []; snap.forEach(d => rows.push({ id: d.id, ...d.data() })); sortNewest(rows); rows.reverse();
    box.innerHTML = rows.length ? rows.map(m => `<div class="msg ${m.senderId === adminUser.uid ? "mine" : ""}"><strong>${safe(m.senderName || "")}</strong><br>${safe(m.text)}</div>`).join("") : `<p class="muted">No messages yet. Start the conversation.</p>`;
    box.scrollTop = box.scrollHeight;
  }, err => toast(err));
}
$("#adminMessageForm")?.addEventListener("submit", async e => {
  e.preventDefault();
  if (!activeChatId) return toast("Choose a user first.");
  try {
    const text = $("#adminMessageText").value.trim(); if (!text) return;
    await addDoc(collection(db, "chats", activeChatId, "messages"), { text, senderId: adminUser.uid, senderName: adminProfile?.name || "Admin", createdAt: serverTimestamp() });
    await updateDoc(doc(db, "chats", activeChatId), { lastMessage: text, updatedAt: serverTimestamp() });
    $("#adminMessageText").value = "";
  } catch (err) { console.error(err); toast(err); }
});
