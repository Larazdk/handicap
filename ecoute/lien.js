/* Alto · Écoute — relier le téléphone à l'ordinateur.
   Le téléphone (près du prof) écoute et écrit. Chaque phrase part en direct vers l'ordinateur.
   Seul le texte voyage, de pair à pair (WebRTC via PeerJS). Le son n'est jamais envoyé.
   Ordinateur : « Relier mon téléphone » → code QR. Téléphone : ouvre le lien du code (…#lien=ID). */
(() => {
  const A = window.AltoEcoute;
  const $ = id => document.getElementById(id);
  if (!A || typeof Peer === "undefined") { const c = $("lien"); if (c) c.hidden = true; return; }

  const KEY_ID = "alto-lien-id";
  const m = location.hash.match(/lien=([\w-]+)/);
  const target = m ? m[1] : null;          // présent = ce téléphone envoie vers cet ordinateur
  const etat = (kind, text) => { const c = $("lien-etat"); c.hidden = false; c.className = "chip " + kind; $("lien-etat-t").textContent = text; };
  const newId = () => "alto-" + Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 8);

  /* ---------------- Le téléphone : il envoie ---------------- */
  if (target) {
    $("lien-go").hidden = true;
    try { $("place").hidden = true; } catch (e) {}   // sur le téléphone, la fenêtre flottante ne sert à rien
    $("lien-intro").textContent = "Ce téléphone envoie le cours à ton ordinateur. Pose-le près du prof, puis démarre l'écoute plus bas.";
    let peer = null, conn = null, sent = 0, retry = null;
    try { $("boost").checked = false; } catch (e) {}   // téléphone près du prof : pas besoin d'amplifier
    const ready = () => conn && conn.open;
    const flush = () => { if (!ready()) return;
      while (sent < A.count()) { const s = A.seg(sent); conn.send({type: "seg", i: sent, text: s.fix || s.text, t: s.t}); sent++; }
      etat("local live", `Relié · ${sent} phrase${sent > 1 ? "s" : ""} envoyée${sent > 1 ? "s" : ""}`); };
    A.onSeg = () => flush();
    A.onInterim = text => { if (ready()) conn.send({type: "interim", text}); };
    const connect = () => {
      clearTimeout(retry);
      if (!peer || peer.destroyed) { peer = new Peer(); peer.on("open", connect); peer.on("error", fail); peer.on("disconnected", () => { try { peer.reconnect(); } catch (e) {} }); return; }
      if (!peer.open) return;
      etat("cloud", "Connexion à l'ordinateur…");
      conn = peer.connect(target, {reliable: true});
      conn.on("open", () => { etat("local live", "Relié à l'ordinateur"); conn.send({type: "hello", total: A.count()}); });
      conn.on("data", d => { if (!d) return;
        if (d.type === "ack") { sent = Math.min(d.n, A.count()); flush(); }
        else if (d.type === "config" && d.gkey && A.setGladia) { A.setGladia(d.gkey); A.note("Ce téléphone utilise maintenant Gladia (clé reçue de l'ordinateur).", "ok"); } });
      conn.on("close", () => { etat("off", "Lien coupé · je réessaie"); retry = setTimeout(connect, 3000); });
      conn.on("error", fail);
    };
    function fail(e) {
      const t = e && e.type;
      etat("off", t === "peer-unavailable" ? "Ordinateur introuvable · ouvre Écoute dessus" : "Lien coupé · je réessaie");
      clearTimeout(retry); retry = setTimeout(connect, 4000);
    }
    connect();
    return;
  }

  /* ---------------- L'ordinateur : il reçoit ---------------- */
  let peer = null, got = 0, last = 0, live = false, gotNow = 0;
  setInterval(() => { if (!live) return; const s = last ? Math.round((Date.now() - last) / 1000) : null;
    etat(s !== null && s < 20 ? "local live" : "cloud", `En direct · ${gotNow} phrase${gotNow > 1 ? "s" : ""} reçue${gotNow > 1 ? "s" : ""}` + (s === null ? " · j'attends la première" : ` · dernière il y a ${s} s`)); }, 1000);
  try { got = Number(localStorage.getItem("alto-lien-got")) || 0; } catch (e) {}
  const saveGot = () => { try { localStorage.setItem("alto-lien-got", got); } catch (e) {} };
  const showQr = id => {
    const url = location.href.split("#")[0] + "#lien=" + id;
    const qr = qrcode(0, "M"); qr.addData(url); qr.make();
    $("qr").innerHTML = qr.createSvgTag({cellSize: 6, margin: 2, scalable: false});
    $("lien-qr").hidden = false;
  };
  const start = (id, tries = 0) => {
    peer = new Peer(id);
    peer.on("open", pid => {
      try { localStorage.setItem(KEY_ID, pid); } catch (e) {}
      showQr(pid); etat("cloud", "En attente du téléphone…"); $("lien-go").textContent = "Afficher à nouveau le code";
    });
    peer.on("connection", conn => {
      if (!A.count()) { got = 0; saveGot(); }   // cours effacé sur l'ordinateur : on repart de zéro
      conn.on("open", () => { live = true; etat("local live", "Téléphone relié · le cours arrive"); $("lien-qr").hidden = true; A.wake(); conn.send({type: "ack", n: got});
        const k = A.gladiaKey && A.gladiaKey(); if (k && $("engine-mode").value === "gladia") conn.send({type: "config", gkey: k}); });
      conn.on("data", d => {
        if (!d) return;
        if (d.type === "hello") { if (typeof d.total === "number" && d.total < got) { got = 0; saveGot(); } conn.send({type: "ack", n: got}); }
        else if (d.type === "seg") { if (d.i === got) { A.addRemote(d.text, d.t || 0); got++; gotNow++; last = Date.now(); saveGot(); } else if (d.i > got) conn.send({type: "ack", n: got}); }
        else if (d.type === "interim") { A.remoteInterim(d.text); if (d.text) last = Date.now(); }
      });
      conn.on("close", () => { live = false; A.remoteInterim(""); etat("off", "Téléphone déconnecté · le texte reçu est gardé"); });
    });
    peer.on("disconnected", () => { try { peer.reconnect(); } catch (e) {} });
    peer.on("error", e => {
      if (e && e.type === "unavailable-id" && tries < 2) { try { peer.destroy(); } catch (x) {} start(newId(), tries + 1); return; }
      etat("off", "Le lien n'a pas pu s'ouvrir (" + ((e && e.type) || "erreur") + "). Vérifie la connexion internet.");
    });
  };
  $("lien-go").addEventListener("click", () => {
    if (peer && peer.open) { showQr(peer.id); return; }
    let id = null; try { id = localStorage.getItem(KEY_ID); } catch (e) {}
    start(id || newId());
  });
})();
