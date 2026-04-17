import React, { useRef, useEffect } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, type VRM } from '@pixiv/three-vrm';
import {
  createMotionScheduler,
  mapStreamEventToAction,
  type ActionName,
  type DebugState,
  type MotionEvent,
  type MotionEventCode,
  type StreamEventType,
} from './vrmMotion';

const VrmViewer: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mountEl = containerRef.current;
    if (!mountEl) return;

    let isDisposed = false;
    let frameHandle = 0;

    const scheduler = createMotionScheduler();
    const allExpressions = ['happy', 'angry', 'sad', 'relaxed', 'surprised', 'neutral', 'blink'];
    let elapsedSec = 0;
    let lastBoneErrorAction: ActionName | null = null;

    let debugState: DebugState = {
      modelReady: false,
      currentAction: 'reset',
      lastErrorCode: null,
      events: [],
    };

    const publishState = () => {
      if (isDisposed) {
        return;
      }
      window.vrmDebugState = debugState;
      window.dispatchEvent(new CustomEvent<DebugState>('vrm-state-change', { detail: debugState }));
    };

    const pushEvent = (code: MotionEventCode, message: string, meta?: Record<string, unknown>) => {
      const event: MotionEvent = { ts: Date.now(), code, message, meta };
      const events = [...debugState.events, event].slice(-20);
      debugState = {
        ...debugState,
        events,
        currentAction: scheduler.getCurrentAction(),
        lastErrorCode: code.includes('REJECTED') || code === 'MODEL_NOT_READY' || code === 'BONE_MISSING' ? code : debugState.lastErrorCode,
      };
      publishState();
    };


    // 1. Scene setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf0f0f0);

    const camera = new THREE.PerspectiveCamera(
      35,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    camera.position.set(0, 1.2, 3); // Positioned to look at the character's upper body

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);

    // Ensure a single canvas exists even under StrictMode/HMR re-mount cycles.
    mountEl.querySelectorAll('canvas').forEach((canvas) => canvas.remove());
    mountEl.appendChild(renderer.domElement);

    // 2. Lighting setup
    const light = new THREE.DirectionalLight(0xffffff, 1.0);
    light.position.set(1, 1, 1).normalize();
    scene.add(light);

    const ambientLight = new THREE.AmbientLight(0x404040); // Soft white light
    scene.add(ambientLight);

    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x334455, 0.55);
    scene.add(hemiLight);

    // 3. VRM Loader setup
    const loader = new GLTFLoader();
    loader.register((parser) => {
      return new VRMLoaderPlugin(parser);
    });

    window.currentVrm = null;

    const frameCameraToModel = (vrm: VRM) => {
      const box = new THREE.Box3().setFromObject(vrm.scene);
      if (box.isEmpty()) {
        return;
      }

      const center = new THREE.Vector3();
      const size = new THREE.Vector3();
      box.getCenter(center);
      box.getSize(size);

      const maxDim = Math.max(size.x, size.y, size.z);
      const fov = THREE.MathUtils.degToRad(camera.fov);
      const distance = Math.max(1.8, (maxDim / (2 * Math.tan(fov / 2))) * 1.35);

      camera.position.set(center.x, center.y + size.y * 0.12, center.z + distance);
      camera.near = Math.max(0.01, distance / 100);
      camera.far = Math.max(50, distance * 30);
      camera.lookAt(center.x, center.y + size.y * 0.35, center.z);
      camera.updateProjectionMatrix();
    };

    const requestAction = (actionName: ActionName, source: 'manual' | 'stream') => {
      if (isDisposed) {
        return;
      }
      const vrm = window.currentVrm as VRM | null;
      if (!vrm?.humanoid && actionName !== 'reset') {
        pushEvent('ACTION_REJECTED_MODEL_NOT_READY', `Action rejected before model ready: ${actionName}`, { source });
        return;
      }

      const result = scheduler.requestAction(actionName, elapsedSec);
      if (!result.accepted) {
        pushEvent(result.code ?? 'ACTION_REJECTED_UNSUPPORTED', result.message ?? 'Action rejected', {
          actionName,
          source,
        });
        return;
      }

      if (actionName === 'reset' && vrm?.humanoid) {
        vrm.humanoid.resetPose();
        pushEvent('POSE_RESET', 'Pose reset', { source });
      } else {
        pushEvent('ACTION_STARTED', `Action started: ${actionName}`, { source });
      }

      lastBoneErrorAction = null;
      debugState = { ...debugState, currentAction: scheduler.getCurrentAction() };
      publishState();
    };

    window.vrmExpression = (expressionName: string, value: number) => {
      const vrm = window.currentVrm as VRM | null;
      if (!vrm?.expressionManager) {
        pushEvent('MODEL_NOT_READY', 'Expression manager not ready');
        return;
      }

      allExpressions.forEach((expr) => vrm.expressionManager?.setValue(expr, 0));
      if (expressionName !== 'reset') {
        vrm.expressionManager.setValue(expressionName, value);
      }
    };

    window.vrmExpressionReset = () => {
      window.vrmExpression?.('reset', 0);
    };

    window.vrmAction = (actionName: ActionName) => {
      requestAction(actionName, 'manual');
    };

    window.vrmStreamEvent = (eventType: StreamEventType, chunkIndex = 0) => {
      const action = mapStreamEventToAction(eventType, chunkIndex);
      requestAction(action, 'stream');
    };

    // 载入真实模型
    loader.load(
      '/model.vrm', // 模型路径
      (gltf) => {
        if (isDisposed) {
          return;
        }
        const vrm = gltf.userData.vrm as VRM;
        scene.add(vrm.scene);
        window.currentVrm = vrm;
        
        // 确保它正确转向面对摄像机
        vrm.scene.rotation.y = Math.PI;
        vrm.scene.position.set(0, 0, 0);

        frameCameraToModel(vrm);

        if (vrm.humanoid) {
          vrm.humanoid.resetPose();
        }

        debugState = {
          ...debugState,
          modelReady: Boolean(vrm.humanoid),
          lastErrorCode: null,
        };
        pushEvent('MODEL_READY', 'VRM model loaded successfully');
      },
      (progress) => {
        if (isDisposed) {
          return;
        }
        const pct = 100.0 * (progress.loaded / progress.total);
        if (pct < 100) {
          pushEvent('MODEL_NOT_READY', `Loading... ${pct.toFixed(1)}%`);
        }
      },
      (error) => {
        if (isDisposed) {
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        pushEvent('MODEL_NOT_READY', `Error loading VRM: ${message}`);
        console.error('Failed to load VRM model.', error);
      }
    );

    // 4. Animation loop
    const clock = new THREE.Clock();

    const animate = () => {
      if (isDisposed) {
        return;
      }
      frameHandle = requestAnimationFrame(animate);

      const vrm = window.currentVrm as VRM | null;
      if (vrm) {
        const deltaTime = clock.getDelta();
        elapsedSec += deltaTime;

        const activeAction = scheduler.getCurrentAction();
        const actionTimeSec = scheduler.getActionTimeSec();

        if (vrm.humanoid && activeAction !== 'reset') {
          if (activeAction === 'wave') {
            const rightUpperArm = vrm.humanoid.getNormalizedBoneNode('rightUpperArm');
            const rightLowerArm = vrm.humanoid.getNormalizedBoneNode('rightLowerArm');
            const rightHand = vrm.humanoid.getNormalizedBoneNode('rightHand');
            
            if (rightUpperArm && rightLowerArm) {
              rightUpperArm.rotation.z = Math.PI / 3;
              rightUpperArm.rotation.x = 0;
              rightLowerArm.rotation.z = -Math.PI / 4;
              rightLowerArm.rotation.x = Math.sin(actionTimeSec * Math.PI * 3) * 0.4;
              if (rightHand) rightHand.rotation.z = -Math.PI / 8;
            } else if (lastBoneErrorAction !== activeAction) {
              pushEvent('BONE_MISSING', 'Wave bones missing: rightUpperArm/rightLowerArm', { action: activeAction });
              lastBoneErrorAction = activeAction;
              requestAction('reset', 'manual');
            }
          } 
          else if (activeAction === 'nod') {
            const neck = vrm.humanoid.getNormalizedBoneNode('neck');
            const head = vrm.humanoid.getNormalizedBoneNode('head');
            if (neck && head) {
              neck.rotation.x = Math.sin(actionTimeSec * Math.PI * 2) * 0.15;
              head.rotation.x = Math.sin(actionTimeSec * Math.PI * 2) * 0.1;
            } else if (lastBoneErrorAction !== activeAction) {
              pushEvent('BONE_MISSING', 'Nod bones missing: neck/head', { action: activeAction });
              lastBoneErrorAction = activeAction;
              requestAction('reset', 'manual');
            }
          }
          else if (activeAction === 'shake') {
            const neck = vrm.humanoid.getNormalizedBoneNode('neck');
            const head = vrm.humanoid.getNormalizedBoneNode('head');
            if (neck && head) {
              neck.rotation.y = Math.sin(actionTimeSec * Math.PI * 2.5) * 0.15;
              head.rotation.y = Math.sin(actionTimeSec * Math.PI * 2.5) * 0.1;
            } else if (lastBoneErrorAction !== activeAction) {
              pushEvent('BONE_MISSING', 'Shake bones missing: neck/head', { action: activeAction });
              lastBoneErrorAction = activeAction;
              requestAction('reset', 'manual');
            }
          }
          else if (activeAction === 'raiseLeftArm') {
            const leftUpperArm = vrm.humanoid.getNormalizedBoneNode('leftUpperArm');
            if (leftUpperArm) {
              leftUpperArm.rotation.z = -Math.PI / 2.5;
            } else if (lastBoneErrorAction !== activeAction) {
              pushEvent('BONE_MISSING', 'Raise-left-arm bone missing: leftUpperArm', { action: activeAction });
              lastBoneErrorAction = activeAction;
              requestAction('reset', 'manual');
            }
          }
        }

        const tickResult = scheduler.tick(deltaTime);
        if (tickResult.shouldResetPose && vrm.humanoid) {
          vrm.humanoid.resetPose();
          pushEvent('ACTION_FINISHED', `Action finished: ${tickResult.finishedAction ?? 'unknown'}`);
          pushEvent('POSE_RESET', 'Pose reset after action finish');
        }

        vrm.update(deltaTime);
      }

      renderer.render(scene, camera);
    };

    animate();

    // Handle window resize
    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      isDisposed = true;
      if (frameHandle) {
        cancelAnimationFrame(frameHandle);
      }
      window.removeEventListener('resize', handleResize);
      window.currentVrm = null;
      window.vrmAction = undefined;
      window.vrmExpression = undefined;
      window.vrmExpressionReset = undefined;
      window.vrmStreamEvent = undefined;
      if (renderer.domElement.parentElement) {
        renderer.domElement.parentElement.removeChild(renderer.domElement);
      }
      renderer.dispose();
    };
  }, []);

  return <div ref={containerRef} style={{ width: '100vw', height: '100vh' }} />;
};

export default VrmViewer;