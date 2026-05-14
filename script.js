/* ================================================================
   STARK INDUSTRIES // SHARED SCRIPT
   - Teachable Machine pose model unlock (index.html)
   - Jarvis welcome typewriter (secret.html)
   - Live clock on both pages
   ================================================================ */

(() => {
  'use strict';

  /* -----------------------------------------------------------
     1. LIVE CLOCK  (runs on both pages)
     ----------------------------------------------------------- */
  const clockEl = document.getElementById('clock');
  if (clockEl) {
    const tick = () => {
      const d = new Date();
      const pad = n => String(n).padStart(2, '0');
      clockEl.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    };
    tick();
    setInterval(tick, 1000);
  }

  /* -----------------------------------------------------------
     2. INDEX PAGE — pose-based lock
     ----------------------------------------------------------- */
  if (document.body.classList.contains('page-locked')) {
    initLockPage();
  }

  /* -----------------------------------------------------------
     3. UNLOCKED PAGE — Jarvis greeting + typewriter
     ----------------------------------------------------------- */
  if (document.body.classList.contains('page-unlocked')) {
    initUnlockedPage();
  }

  /* ===========================================================
     INDEX / LOCK PAGE LOGIC
     =========================================================== */
  function initLockPage() {

    /* -- Riddle / clue rotation -- */
    const clues = [
      '"Not every hero wears the suit first. Raise the weapon that needs no bullets."',
      '"The key is in the palm of your hand."',
      '"Sometimes, the best weapon is pointed forward."'
    ];
    const riddleEl    = document.getElementById('riddle-text');
    const clueIdxEl   = document.getElementById('clue-index');
    const nextBtn     = document.getElementById('next-clue-btn');
    let   clueIndex   = 0;

    nextBtn.addEventListener('click', () => {
      if (clueIndex >= clues.length - 1) return;
      clueIndex++;
      riddleEl.classList.add('fading');
      setTimeout(() => {
        riddleEl.textContent = clues[clueIndex];
        clueIdxEl.textContent = String(clueIndex + 1).padStart(2, '0');
        riddleEl.classList.remove('fading');
        if (clueIndex === clues.length - 1) {
          nextBtn.disabled = true;
          nextBtn.querySelector('span').textContent = 'NO MORE HINTS';
        }
      }, 350);
    });

    /* -- Webcam + Teachable Machine pose model -- */
    // Public model URL provided by user
    const MODEL_URL  = 'https://teachablemachine.withgoogle.com/models/mqVvE3_58/';

    const startBtn      = document.getElementById('start-btn');
    const screenEl      = document.getElementById('scanner-screen');
    const placeholderEl = document.getElementById('scanner-placeholder');
    const statusLabel   = document.getElementById('status-label');
    const hintEl        = document.getElementById('readout-hint');
    const targetBar     = document.getElementById('target-bar');
    const neutralBar    = document.getElementById('neutral-bar');
    const targetPct     = document.getElementById('target-pct');
    const neutralPct    = document.getElementById('neutral-pct');
    const grantedOverlay= document.getElementById('granted-overlay');

    let model, webcam, overlayCtx, overlayCanvas, maxPredictions;
    let isRunning   = false;
    let unlocked    = false;
    let holdSince   = null;
    const HOLD_MS   = 1500;          // hold pose for 1.5s
    const THRESHOLD = 0.85;          // confidence required

    startBtn.addEventListener('click', () => initWebcam().catch(handleInitError));

    async function initWebcam() {
      startBtn.disabled = true;
      startBtn.textContent = 'INITIALIZING...';

      const modelURL    = MODEL_URL + 'model.json';
      const metadataURL = MODEL_URL + 'metadata.json';

      // 1) Load the Teachable Machine pose model
      model = await tmPose.load(modelURL, metadataURL);
      maxPredictions = model.getTotalClasses();

      // 2) Set up the webcam helper. tmPose.Webcam internally creates
      //    a <canvas> AND a hidden <video>, and on every update() it
      //    draws the latest video frame onto webcam.canvas. So if we
      //    just append webcam.canvas to the DOM, the user sees the feed.
      const size = 480;
      const flip = true; // mirror it
      webcam = new tmPose.Webcam(size, size, flip);
      await webcam.setup({ facingMode: 'user' });
      await webcam.play();

      // 3) Mount the webcam canvas directly (this is the actual video frame)
      placeholderEl.style.display = 'none';
      webcam.canvas.classList.add('cam-feed');
      screenEl.appendChild(webcam.canvas);

      // 4) Add a transparent overlay canvas ON TOP for skeleton lines.
      overlayCanvas = document.createElement('canvas');
      overlayCanvas.width  = size;
      overlayCanvas.height = size;
      overlayCanvas.classList.add('cam-overlay');
      overlayCtx = overlayCanvas.getContext('2d');
      screenEl.appendChild(overlayCanvas);

      screenEl.classList.add('scanning');
      statusLabel.textContent = 'SCANNING';
      hintEl.innerHTML = 'Hold the <strong>REPULSOR POSE</strong> for 1.5s.';

      isRunning = true;
      window.requestAnimationFrame(loop);
    }

    function handleInitError(err) {
      console.error('Pose model init failed:', err);
      startBtn.disabled = false;
      startBtn.textContent = 'RETRY SCAN';
      let msg = 'camera/model unavailable. Check permissions.';
      if (err && err.name === 'NotAllowedError') msg = 'camera permission denied.';
      else if (err && err.name === 'NotFoundError') msg = 'no camera found.';
      else if (err && err.message) msg = err.message;
      hintEl.innerHTML = '<strong>ERROR:</strong> ' + msg;
      hintEl.style.color = 'var(--crimson)';
    }

    async function loop() {
      if (!isRunning) return;
      webcam.update();           // pulls the latest video frame onto webcam.canvas
      await predict();
      window.requestAnimationFrame(loop);
    }

    async function predict() {
      // Pose & class predictions
      const { pose, posenetOutput } = await model.estimatePose(webcam.canvas);
      const prediction = await model.predict(posenetOutput);

      // Draw skeleton on the OVERLAY canvas only (webcam canvas already shows video)
      drawPoseOverlay(pose);

      // Find the "target" class — the one with highest confidence that isn't
      // "neutral" / "background" / "class 1" depending on the user's labels.
      // Strategy: assume the first non-neutral-named class is the pose, but
      // to stay generic we just pick the highest-prob class and the next.
      let sorted = [...prediction].sort((a, b) => b.probability - a.probability);
      let top    = sorted[0];
      let second = sorted[1] || { className: '—', probability: 0 };

      // Heuristic: any class whose lowercase name includes
      // "neutral", "none", "class 1", or "background" is treated as NEUTRAL.
      const isNeutral = (name) => /neutral|none|background|class\s*1/i.test(name);

      // Determine which is the target pose (the one we want)
      let targetClass, neutralClass;
      if (isNeutral(top.className) && !isNeutral(second.className)) {
        neutralClass = top; targetClass = second;
      } else if (!isNeutral(top.className) && isNeutral(second.className)) {
        targetClass = top; neutralClass = second;
      } else {
        // Fall back: highest prob == target, next == neutral
        targetClass = top; neutralClass = second;
      }

      // Update bars
      const tProb = targetClass.probability;
      const nProb = neutralClass.probability;
      targetBar.style.width  = (tProb * 100).toFixed(1) + '%';
      neutralBar.style.width = (nProb * 100).toFixed(1) + '%';
      targetPct.textContent  = (tProb * 100).toFixed(0) + '%';
      neutralPct.textContent = (nProb * 100).toFixed(0) + '%';

      // Hold detection
      if (!unlocked && tProb >= THRESHOLD) {
        if (holdSince === null) holdSince = performance.now();
        const heldFor = performance.now() - holdSince;
        if (heldFor >= HOLD_MS) {
          triggerUnlock();
        } else {
          hintEl.innerHTML = `Pose detected. Holding... <strong>${(heldFor / 1000).toFixed(1)}s</strong> / 1.5s`;
        }
      } else if (!unlocked) {
        holdSince = null;
        hintEl.innerHTML = 'Hold the <strong>REPULSOR POSE</strong> for 1.5s to authenticate.';
      }
    }

    function drawPoseOverlay(pose) {
      if (!overlayCtx) return;
      // Clear the overlay each frame (transparent — webcam canvas is below)
      overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
      if (pose) {
        const minPart = 0.5;
        tmPose.drawKeypoints(pose.keypoints, minPart, overlayCtx);
        tmPose.drawSkeleton(pose.keypoints, minPart, overlayCtx);
      }
    }

    function triggerUnlock() {
      if (unlocked) return;
      unlocked = true;
      isRunning = false;
      statusLabel.textContent = 'ACCESS GRANTED';
      hintEl.classList.add('success');
      hintEl.innerHTML = '<strong>IDENTITY CONFIRMED.</strong> Welcome back, Mr. Stark.';

      grantedOverlay.classList.add('active');

      // Stop webcam after a short visual delay
      setTimeout(() => {
        try { webcam && webcam.stop(); } catch (e) {}
      }, 1200);

      // Redirect to secret page after the granted animation finishes
      setTimeout(() => {
        window.location.href = 'secret.html';
      }, 2600);
    }
  }

  /* ===========================================================
     UNLOCKED / SECRET PAGE LOGIC
     =========================================================== */
  function initUnlockedPage() {
    const welcomeText = document.getElementById('welcome-text');
    const audio       = document.getElementById('jarvis-audio');
    const video       = document.getElementById('archive-video');

    const greeting = 'Welcome back, Mr. Stark. Restoring last session...';

    // Typewriter effect for Jarvis greeting
    let i = 0;
    const typeNext = () => {
      if (i <= greeting.length) {
        welcomeText.textContent = greeting.slice(0, i);
        i++;
        setTimeout(typeNext, 38);
      }
    };
    setTimeout(typeNext, 400);

    // Play Jarvis audio — browsers require a user gesture. We try to play
    // automatically; if blocked, we wait for the first click/touch.
    const tryPlayAudio = () => {
      audio.play().catch(() => {
        const unlockAudio = () => {
          audio.play().catch(() => {});
          document.removeEventListener('click', unlockAudio);
          document.removeEventListener('keydown', unlockAudio);
          document.removeEventListener('touchstart', unlockAudio);
        };
        document.addEventListener('click', unlockAudio, { once: false });
        document.addEventListener('keydown', unlockAudio, { once: false });
        document.addEventListener('touchstart', unlockAudio, { once: false });
      });
    };

    // Slight delay so it lands with the visual reveal
    setTimeout(tryPlayAudio, 600);

    // Same forgiveness for the video
    if (video) {
      video.play().catch(() => {
        const unlockVideo = () => {
          video.play().catch(() => {});
          document.removeEventListener('click', unlockVideo);
        };
        document.addEventListener('click', unlockVideo, { once: true });
      });
    }
  }
})();
