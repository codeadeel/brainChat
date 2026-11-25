import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { Html, Line, OrbitControls, useGLTF, useProgress } from "@react-three/drei";
import * as THREE from "three";
import type { ChannelMeta } from "../types";

const ROI_COLOR: Record<string, string> = {
  medial_ba10: "#d94a4a",
  left_pfc: "#c27c0e",
  right_s1: "#2f855a",
  short: "#94a3b8",
  other: "#64748b",
};

const ROI_LABEL: Record<string, string> = {
  medial_ba10: "medial BA10",
  left_pfc: "left PFC",
  right_s1: "right S1",
  short: "short separation",
  other: "other",
};

type ProbeMode = "face" | "brain";

type OptodeGroup = "left" | "medial" | "right";

function optodeGroup(name: string): OptodeGroup {
  const n = Number(name.replace(/[^0-9]/g, ""));
  if (name.startsWith("S")) return n >= 7 ? "right" : n >= 4 ? "medial" : "left";
  if (name.startsWith("D")) {
    if ([9, 10, 11, 12, 19, 20, 21].includes(n)) return "right";
    if ([1, 2, 3, 4, 13, 14].includes(n)) return "left";
  }
  return "medial";
}

function optodeDirection(x: number, y: number, group: OptodeGroup): [number, number, number] {
  if (group === "right") {
    // Right S1: right temple, just above the ear.
    return [
      0.84 + ((Math.max(40, Math.min(115, x)) - 40) / 75) * 0.16,
      0.1 + ((Math.max(-30, Math.min(30, y)) + 30) / 60) * 0.2,
      0.28,
    ];
  }
  if (group === "left") {
    // Left lateral PFC: upper left forehead.
    return [
      -(0.6 + ((Math.max(40, Math.min(130, -x)) - 40) / 90) * 0.18),
      0.4 + ((Math.max(35, Math.min(100, y)) - 35) / 65) * 0.25,
      0.62,
    ];
  }
  // Medial BA10: the forehead, above the eyebrows (2 x 4 grid).
  return [
    (Math.max(-30, Math.min(30, x)) / 30) * 0.4,
    0.5 + ((Math.max(55, Math.min(106, y)) - 55) / 51) * 0.25,
    0.85,
  ];
}

function snapToHead(
  direction: [number, number, number],
  meshes: THREE.Object3D[],
  center = new THREE.Vector3(0, 0.2, 0),
): [number, number, number] {
  const d = new THREE.Vector3(...direction).normalize();
  const raycaster = new THREE.Raycaster(
    center.clone().addScaledVector(d, 3.0),
    d.clone().negate(),
  );
  const hits = raycaster.intersectObjects(meshes, true);
  if (hits.length) {
    const p = hits[0].point.clone().addScaledVector(d, 0.012);
    return [p.x, p.y, p.z];
  }
  // Fallback: project onto an ellipsoid close to the head surface.
  const ell = new THREE.Vector3(
    d.x / 1.17,
    d.y / 1.18,
    d.z / 0.8,
  ).normalize();
  return [ell.x * 1.17, ell.y * 1.18, ell.z * 0.8];
}

function valueColor(value: number | undefined, fallback: string) {
  if (value === undefined || !Number.isFinite(value) || Math.abs(value) < 0.01) return fallback;
  const mag = Math.min(1, Math.abs(value) / 0.25);
  return value >= 0 ? `rgba(217,74,74,${0.45 + mag * 0.5})` : `rgba(37,99,235,${0.45 + mag * 0.5})`;
}

interface Hover {
  label: string;
  sub: string;
  position: [number, number, number];
}

function useHeadRoot() {
  const { scene } = useGLTF("/models/head.glb");
  const textures = useMemo(() => {
    const loader = new THREE.TextureLoader();
    const color = loader.load("/models/head-color.jpg");
    color.colorSpace = THREE.SRGBColorSpace;
    color.anisotropy = 8;
    const normal = loader.load("/models/head-normal.jpg");
    normal.colorSpace = THREE.NoColorSpace;
    return { color, normal };
  }, []);
  return useMemo(() => {
    const cloned = scene.clone(true);
    cloned.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        (o as THREE.Mesh).material = new THREE.MeshStandardMaterial({
          map: textures.color,
          normalMap: textures.normal,
          normalScale: new THREE.Vector2(1.1, 1.1),
          roughness: 0.9,
          metalness: 0,
          transparent: false,
          opacity: 1,
          depthWrite: true,
          side: THREE.FrontSide,
        });
      }
    });
    cloned.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(cloned);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const s = 2.45 / size.y;
    cloned.scale.setScalar(s);
    cloned.position.set(-center.x * s, -center.y * s + 0.03, -center.z * s);
    cloned.updateMatrixWorld(true);
    return cloned;
  }, [scene, textures]);
}

function HeadModel({ root, mode }: { root: THREE.Object3D; mode: ProbeMode }) {
  useEffect(() => {
    root.visible = mode === "face";
  }, [root, mode]);
  return <primitive object={root} />;
}
function BrainModel({ mode }: { mode: ProbeMode }) {
  const { scene } = useGLTF("/models/brain.glb");
  const root = useMemo(() => {
    const cloned = scene.clone(true);
    cloned.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const clonedMats = mats.map((m) => {
        const c = m.clone() as THREE.MeshStandardMaterial;
        c.color = new THREE.Color("#e9bcc9");
        c.roughness = 0.55;
        c.metalness = 0;
        c.emissive = new THREE.Color("#ffffff");
        c.emissiveIntensity = 0.15;
        if (c.map) c.emissiveMap = c.map;
        return c;
      });
      mesh.material = clonedMats.length === 1 ? clonedMats[0] : clonedMats;
    });
    cloned.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(cloned);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const s = Math.min(1.1 / size.x, 1.2 / size.z, 0.95 / size.y);
    cloned.scale.setScalar(s);
    cloned.position.set(-center.x * s, -center.y * s + 0.38, -center.z * s - 0.02);
    cloned.updateMatrixWorld(true);
    return cloned;
  }, [scene]);

  return <primitive object={root} visible={mode === "brain"} />;
}



function CameraRig({ mode }: { mode: ProbeMode }) {
  const { camera } = useThree();
  useEffect(() => {
    if (mode === "brain") {
      // Dorsal 3/4: the two hemispheres with the fissure read like a brain.
      camera.position.set(1.7, 2.5, 2.3);
      camera.lookAt(0, 0.3, 0);
    } else {
      camera.position.set(0, 0.25, 4.65);
      camera.lookAt(0, 0.3, 0);
    }
    camera.updateProjectionMatrix();
  }, [camera, mode]);
  return null;
}

function BrainScene({
  channels,
  selected,
  values,
  onToggle,
  mode,
  autoRotate,
  onHover,
  controlsRef,
}: {
  channels: ChannelMeta[];
  selected: string[];
  values?: Record<string, number>;
  onToggle: (name: string) => void;
  mode: ProbeMode;
  autoRotate: boolean;
  onHover: (hover: Hover | null) => void;
  controlsRef: React.Ref<any>;
}) {
  const headRoot = useHeadRoot();
  const headMeshes = useMemo(() => {
    const meshes: THREE.Object3D[] = [];
    headRoot.updateMatrixWorld(true);
    headRoot.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes.push(o);
    });
    return meshes;
  }, [headRoot]);

  const sources = useMemo(() => {
    const map = new Map<string, [number, number, number]>();
    for (const c of channels) {
      if (c.source_xy) {
        const dir = optodeDirection(c.source_xy[0], c.source_xy[1], optodeGroup(c.source));
        map.set(c.source, snapToHead(dir, headMeshes));
      }
    }
    return map;
  }, [channels, headMeshes]);

  const detectors = useMemo(() => {
    const map = new Map<string, [number, number, number]>();
    for (const c of channels) {
      if (c.detector_xy) {
        const dir = optodeDirection(c.detector_xy[0], c.detector_xy[1], optodeGroup(c.detector));
        map.set(c.detector, snapToHead(dir, headMeshes));
      }
    }
    return map;
  }, [channels, headMeshes]);

  const midpoints = useMemo(() => {
    return channels.map((c) => {
      const s = sources.get(c.source);
      const d = detectors.get(c.detector);
      if (!s || !d) return null;
      const mid = new THREE.Vector3((s[0] + d[0]) / 2, (s[1] + d[1]) / 2, (s[2] + d[2]) / 2);
      const position = snapToHead([mid.x, mid.y, mid.z], headMeshes);
      const linePoints: [number, number, number][] = [
        s,
        [position[0] * 1.01, position[1] * 1.01, position[2] * 1.01],
        d,
      ];
      return { channel: c, position, linePoints };
    });
  }, [channels, sources, detectors, headMeshes]);

  return (
    <>
      <ambientLight intensity={0.85} />
      <directionalLight position={[2.5, 4, 4.5]} intensity={1.15} color="#ffffff" />
      <directionalLight position={[-3, 1.5, 2.5]} intensity={0.55} color="#eef2ff" />

      <mesh position={[0, -1.28, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.9, 64]} />
        <meshBasicMaterial color="#94a3b8" transparent opacity={0.12} />
      </mesh>

      <Suspense fallback={null}>
        <HeadModel root={headRoot} mode={mode} />
        <BrainModel mode={mode} />
      </Suspense>

      {midpoints.map((m) => {
        if (!m) return null;
        const { channel: c, position, linePoints } = m;
        const s = sources.get(c.source);
        const d = detectors.get(c.detector);
        if (!s || !d) return null;
        const active = selected.includes(c.name);
        const color = ROI_COLOR[c.roi] ?? ROI_COLOR.other;
        const value = values?.[c.name];
        return (
          <group key={c.name}>
            <Line
              points={linePoints}
              color={color}
              lineWidth={active ? 2.8 : 1.1}
              transparent
              opacity={active ? 0.95 : c.short ? 0.22 : 0.5}
              dashed={c.short}
              dashScale={18}
              dashSize={0.7}
              gapSize={0.5}
            />
            {active && (
              <mesh position={position}>
                <sphereGeometry args={[0.045, 16, 16]} />
                <meshBasicMaterial color="#0f766e" transparent opacity={0.22} depthWrite={false} />
              </mesh>
            )}
            <mesh
              position={position}
              onClick={() => onToggle(c.name)}
              onPointerOver={(e) => {
                e.stopPropagation();
                onHover({
                  label: `${c.name}${c.paper_index ? ` · C${c.paper_index}` : ""}`,
                  sub: `${ROI_LABEL[c.roi] ?? c.roi} · SCI ${c.sci?.toFixed(2) ?? "n/a"}${
                    value !== undefined ? ` · now ${value >= 0 ? "+" : ""}${value.toFixed(3)} µM` : ""
                  }${c.paper_index === 10 || c.paper_index === 14 || c.paper_index === 15 || c.paper_index === 16 ? " · paper BA10 channel" : ""}`,
                  position,
                });
              }}
              onPointerOut={() => onHover(null)}
            >
              <sphereGeometry args={[active ? 0.034 : 0.026, 18, 18]} />
              <meshStandardMaterial
                color={valueColor(value, color)}
                emissive={color}
                emissiveIntensity={active ? 0.35 : 0.1}
                roughness={0.4}
              />
            </mesh>
          </group>
        );
      })}

      {Array.from(sources.entries()).map(([name, position]) => (
        <mesh
          key={`source-${name}`}
          position={position}
          onPointerOver={(e) => {
            e.stopPropagation();
            onHover({ label: name, sub: "source optode", position });
          }}
          onPointerOut={() => onHover(null)}
        >
          <sphereGeometry args={[0.022, 16, 16]} />
          <meshStandardMaterial color="#d94a4a" emissive="#7f1d1d" emissiveIntensity={0.25} roughness={0.35} />
        </mesh>
      ))}
      {Array.from(detectors.entries()).map(([name, position]) => (
        <mesh
          key={`detector-${name}`}
          position={position}
          onPointerOver={(e) => {
            e.stopPropagation();
            onHover({ label: name, sub: "detector optode", position });
          }}
          onPointerOut={() => onHover(null)}
        >
          <sphereGeometry args={[0.022, 16, 16]} />
          <meshStandardMaterial color="#2563eb" emissive="#1e3a8a" emissiveIntensity={0.22} roughness={0.35} />
        </mesh>
      ))}

      <OrbitControls
        ref={controlsRef}
        enablePan
        enableDamping
        dampingFactor={0.14}
        rotateSpeed={1.25}
        zoomSpeed={1.2}
        autoRotate={autoRotate}
        autoRotateSpeed={2.2}
        minDistance={2.8}
        maxDistance={6.5}
        target={[0, 0.32, 0]}
      />
    </>
  );
}

export default function BrainModel3D({
  channels,
  selected,
  values,
  onToggle,
}: {
  channels: ChannelMeta[];
  selected: string[];
  values?: Record<string, number>;
  onToggle: (name: string) => void;
}) {
  const [mode, setMode] = useState<ProbeMode>(() => {
    const q = new URLSearchParams(window.location.search).get("probe");
    return q === "face" || q === "brain" ? q : "face";
  });
  const [autoRotate, setAutoRotate] = useState(false);
  const [hover, setHover] = useState<Hover | null>(null);
  const [webgl, setWebgl] = useState(true);
  const { active: loadingAnatomy, progress } = useProgress();
  const controlsRef = useRef<any>(null);

  const dolly = (k: number) => {
    const c = controlsRef.current;
    if (!c) return;
    if (k > 1) c.dollyIn(k);
    else c.dollyOut(1 / k);
    c.update();
  };

  const resetCam = () => {
    const c = controlsRef.current;
    if (!c) return;
    if (mode === "brain") {
      c.object.position.set(1.7, 2.5, 2.3);
      c.target.set(0, 0.3, 0);
    } else {
      c.object.position.set(0, 0.25, 4.65);
      c.target.set(0, 0.3, 0);
    }
    c.update();
  };

  useEffect(() => {
    try {
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
      setWebgl(!!gl);
    } catch {
      setWebgl(false);
    }
  }, []);

  if (!webgl) {
    return (
      <div className="brain-fallback">
        <b>3D view unavailable</b>
        <p>This browser could not start WebGL. Switch to the 2D probe map above.</p>
      </div>
    );
  }

  return (
    <div className="brain-wrap">
      <div className="brain-controls">
        <div className="brain-mode">
          {(["face", "brain"] as const).map((m) => (
            <button key={m} className={mode === m ? "active" : ""} onClick={() => setMode(m)}>
              {m === "face" ? "Face" : "Brain"}
            </button>
          ))}
        </div>
        <button onClick={() => setAutoRotate((v) => !v)}>{autoRotate ? "Pause spin" : "Auto spin"}</button>
        <div className="brain-zoom">
          <button onClick={() => dolly(1.25)} title="Zoom in">＋</button>
          <button onClick={() => dolly(1 / 1.25)} title="Zoom out">−</button>
          <button onClick={resetCam} title="Reset view">⟲</button>
        </div>
      </div>
      <div className="brain-canvas">
        <Canvas
          camera={{ position: [0, 0.25, 4.65], fov: 33 }}
          dpr={[1, 1.5]}
          gl={{ antialias: true, alpha: true }}
          style={{ background: "transparent" }}
        >
          <CameraRig mode={mode} />
          <Suspense fallback={null}>
            <BrainScene
              channels={channels}
              selected={selected}
              values={values}
              onToggle={onToggle}
              mode={mode}
              autoRotate={autoRotate}
              onHover={setHover}
              controlsRef={controlsRef}
            />
          </Suspense>
          {hover && (
            <Html position={hover.position} center distanceFactor={5} className="brain-tooltip">
              <b>{hover.label}</b>
              <span>{hover.sub}</span>
            </Html>
          )}
        </Canvas>
        {mode === "face" && (
          <>
            <div className="brain-medial-label">medial BA10</div>
            <div className="brain-left-label">left PFC</div>
            <div className="brain-right-label">right S1</div>
          </>
        )}
        {loadingAnatomy && (
          <div className="brain-loading">Loading anatomy… {Math.round(progress)}%</div>
        )}
      </div>
      <div className="brain-legend">
        <span><i className="optode-dot src" /> source</span>
        <span><i className="optode-dot det" /> detector</span>
        <span><i className="line-dot short" /> short</span>
        <span><i className="mid-dot" style={{ background: "#d94a4a" }} /> HbO ↑</span>
        <span><i className="mid-dot" style={{ background: "#2563eb" }} /> HbO ↓</span>
        {mode === "brain" && (
          <span className="brain-roi-key">
            channels: <i style={{ background: "#d94a4a" }} /> medial
            <i style={{ background: "#c27c0e" }} /> left
            <i style={{ background: "#2f855a" }} /> right
          </span>
        )}
        <span className="brain-hint">drag to rotate · scroll to zoom · click a dot</span>
      </div>
      {mode === "brain" && (
        <p className="brain-caption">
          Dorsal ¾ cortical view — both hemispheres with the central fissure, frontal poles
          forward and the cerebellum at the back. Electrodes stay at their scalp positions
          around the cortex.
        </p>
      )}
    </div>
  );
}

useGLTF.preload("/models/head.glb");
useGLTF.preload("/models/brain.glb");
