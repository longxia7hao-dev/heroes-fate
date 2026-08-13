/**
 * Simple 3D hero model viewer (Three.js)
 * Plane billboard + soft lights, drag to rotate, idle auto-spin
 */
window.HF_Viewer3D = (() => {
  let renderer, scene, camera, mesh, frameId;
  let yaw = 0.35;
  let pitch = 0.12;
  let auto = true;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let container = null;
  let texLoader = null;
  let currentUrl = "";

  function ensureThree() {
    return new Promise((resolve, reject) => {
      if (window.THREE) return resolve(window.THREE);
      const s = document.createElement("script");
      s.src = "https://unpkg.com/three@0.160.0/build/three.min.js";
      s.onload = () => resolve(window.THREE);
      s.onerror = () => reject(new Error("Three.js load failed"));
      document.head.appendChild(s);
    });
  }

  async function mount(el) {
    container = el;
    const THREE = await ensureThree();
    texLoader = new THREE.TextureLoader();

    const w = el.clientWidth || 280;
    const h = el.clientHeight || 240;

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(32, w / h, 0.1, 100);
    camera.position.set(0, 0.15, 3.2);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    renderer.setClearColor(0x000000, 0);
    el.innerHTML = "";
    el.appendChild(renderer.domElement);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.touchAction = "none";
    renderer.domElement.style.cursor = "grab";

    const amb = new THREE.AmbientLight(0xffffff, 0.85);
    scene.add(amb);
    const key = new THREE.DirectionalLight(0xffe8b0, 1.1);
    key.position.set(2, 3, 4);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xa78bfa, 0.7);
    rim.position.set(-3, 1, -2);
    scene.add(rim);
    const fill = new THREE.PointLight(0x7ef0ff, 0.45, 12);
    fill.position.set(0, -0.5, 2);
    scene.add(fill);

    // ground disc glow
    const discGeo = new THREE.CircleGeometry(0.95, 48);
    const discMat = new THREE.MeshBasicMaterial({
      color: 0xc084fc,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
    });
    const disc = new THREE.Mesh(discGeo, discMat);
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = -0.95;
    scene.add(disc);

    const ringGeo = new THREE.RingGeometry(0.75, 0.95, 48);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xe9d5ff,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -0.94;
    scene.add(ring);

    // hero plane
    const geo = new THREE.PlaneGeometry(1.7, 1.9);
    const mat = new THREE.MeshStandardMaterial({
      transparent: true,
      roughness: 0.55,
      metalness: 0.08,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = 0.05;
    scene.add(mesh);

    // interactions
    const canvas = renderer.domElement;
    const onDown = (e) => {
      dragging = true;
      auto = false;
      const pt = e.touches ? e.touches[0] : e;
      lastX = pt.clientX;
      lastY = pt.clientY;
      canvas.style.cursor = "grabbing";
    };
    const onMove = (e) => {
      if (!dragging) return;
      const pt = e.touches ? e.touches[0] : e;
      const dx = pt.clientX - lastX;
      const dy = pt.clientY - lastY;
      lastX = pt.clientX;
      lastY = pt.clientY;
      yaw += dx * 0.01;
      pitch = Math.max(-0.45, Math.min(0.55, pitch + dy * 0.008));
    };
    const onUp = () => {
      dragging = false;
      canvas.style.cursor = "grab";
      // resume auto spin after short delay
      setTimeout(() => {
        if (!dragging) auto = true;
      }, 1600);
    };
    canvas.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    canvas.addEventListener("touchstart", onDown, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onUp);

    const onResize = () => {
      if (!container || !renderer) return;
      const nw = container.clientWidth || 280;
      const nh = container.clientHeight || 240;
      camera.aspect = nw / nh;
      camera.updateProjectionMatrix();
      renderer.setSize(nw, nh, false);
    };
    window.addEventListener("resize", onResize);

    const animate = () => {
      frameId = requestAnimationFrame(animate);
      if (auto && !dragging) yaw += 0.008;
      if (mesh) {
        mesh.rotation.y = yaw;
        mesh.rotation.x = pitch;
        // subtle bob
        mesh.position.y = 0.05 + Math.sin(performance.now() * 0.0025) * 0.04;
      }
      // spin ring
      ring.rotation.z += 0.01;
      renderer.render(scene, camera);
    };
    animate();
  }

  function setHero(url) {
    if (!texLoader || !mesh || url === currentUrl) {
      if (url !== currentUrl && texLoader && mesh) {
        // fallthrough
      } else if (url === currentUrl) return;
    }
    currentUrl = url;
    const THREE = window.THREE;
    texLoader.load(
      url,
      (tex) => {
        if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
        mesh.material.map = tex;
        mesh.material.needsUpdate = true;
        yaw = 0.45;
        pitch = 0.1;
        auto = true;
      },
      undefined,
      () => console.warn("texture fail", url)
    );
  }

  function dispose() {
    if (frameId) cancelAnimationFrame(frameId);
    if (renderer) {
      renderer.dispose();
      if (renderer.domElement?.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
    }
    renderer = scene = camera = mesh = null;
  }

  return { mount, setHero, dispose };
})();
