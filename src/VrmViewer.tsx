import React, { useRef, useEffect } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, type VRM } from '@pixiv/three-vrm';
import {
  mapStreamEventToAction,
  type ActionName,
  type DebugState,
  type MotionEvent,
  type MotionEventCode,
  type StreamEventType,
} from './vrmMotion';
import { VrmActionController, type VrmAiCommand, type VrmGestureName } from './vrmActionController';

type RuntimeActionName = ActionName | 'walkInPlace' | 'walkForward' | 'turnLeft' | 'turnRight' | 'stop';

const VrmViewer: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mountEl = containerRef.current;
    if (!mountEl) return;

    let isDisposed = false;
    let frameHandle = 0;

    const actionController = new VrmActionController();
    const allExpressions = ['happy', 'angry', 'sad', 'relaxed', 'surprised', 'neutral', 'blink'];
    let currentActionName: RuntimeActionName = 'reset';

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
        currentAction: currentActionName,
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

    const setCurrentActionName = (actionName: RuntimeActionName) => {
      if (currentActionName === actionName) {
        return;
      }
      currentActionName = actionName;
      debugState = {
        ...debugState,
        currentAction: currentActionName,
      };
      publishState();
    };

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

    const requestAction = (actionName: RuntimeActionName, source: 'manual' | 'stream' | 'ai') => {
      if (isDisposed) {
        return;
      }
      const vrm = window.currentVrm as VRM | null;
      if (!vrm?.humanoid && actionName !== 'reset') {
        pushEvent('ACTION_REJECTED_MODEL_NOT_READY', `Action rejected before model ready: ${actionName}`, { source });
        return;
      }

      if (actionName === 'reset') {
        actionController.reset();
        setCurrentActionName('reset');
        pushEvent('POSE_RESET', 'Pose reset', { source });
        return;
      }

      if (actionName === 'stop') {
        actionController.stopLocomotion();
        setCurrentActionName('stop');
        pushEvent('ACTION_FINISHED', 'Locomotion stopped', { source });
        return;
      }

      if (actionName === 'walkInPlace') {
        actionController.setLocomotion('inPlace', 0.9, 0);
        setCurrentActionName('walkInPlace');
        pushEvent('ACTION_STARTED', 'Locomotion started: walkInPlace', { source });
        return;
      }

      if (actionName === 'walkForward') {
        actionController.setLocomotion('forward', 1.0, 0);
        setCurrentActionName('walkForward');
        pushEvent('ACTION_STARTED', 'Locomotion started: walkForward', { source });
        return;
      }

      if (actionName === 'turnLeft') {
        actionController.setLocomotion('forward', 0.7, 1.0);
        setCurrentActionName('turnLeft');
        pushEvent('ACTION_STARTED', 'Locomotion started: turnLeft', { source });
        return;
      }

      if (actionName === 'turnRight') {
        actionController.setLocomotion('forward', 0.7, -1.0);
        setCurrentActionName('turnRight');
        pushEvent('ACTION_STARTED', 'Locomotion started: turnRight', { source });
        return;
      }

      actionController.triggerGesture(actionName as VrmGestureName);
      setCurrentActionName(actionName);
      pushEvent('ACTION_STARTED', `Action started: ${actionName}`, { source });
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

    window.vrmAICommand = (command: VrmAiCommand) => {
      if (!command || typeof command !== 'object') {
        return;
      }

      actionController.dispatch(command);
      if (command.type === 'gesture' && command.gesture) {
        setCurrentActionName(command.gesture);
        pushEvent('ACTION_STARTED', `AI gesture: ${command.gesture}`, { command });
        return;
      }

      if (command.type === 'locomotion') {
        const mode = command.mode ?? 'inPlace';
        const actionName: RuntimeActionName =
          mode === 'forward' ? 'walkForward' : mode === 'inPlace' ? 'walkInPlace' : 'stop';
        setCurrentActionName(actionName);
        pushEvent('ACTION_STARTED', `AI locomotion: ${mode}`, { command });
        return;
      }

      setCurrentActionName('stop');
      pushEvent('ACTION_FINISHED', 'AI command stop', { command });
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
        actionController.bind(vrm);
        setCurrentActionName('reset');

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
        actionController.update(deltaTime);

        const snapshot = actionController.getSnapshot();
        if (snapshot.activeGesture) {
          setCurrentActionName(snapshot.activeGesture);
        } else if (snapshot.locomotionMode === 'forward' && Math.abs(snapshot.turnRate) > 0.3) {
          setCurrentActionName(snapshot.turnRate > 0 ? 'turnLeft' : 'turnRight');
        } else if (snapshot.locomotionMode === 'forward') {
          setCurrentActionName('walkForward');
        } else if (snapshot.locomotionMode === 'inPlace') {
          setCurrentActionName('walkInPlace');
        } else if (currentActionName !== 'reset' && currentActionName !== 'stop') {
          setCurrentActionName('reset');
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
      window.vrmAICommand = undefined;
      actionController.unbind();
      if (renderer.domElement.parentElement) {
        renderer.domElement.parentElement.removeChild(renderer.domElement);
      }
      renderer.dispose();
    };
  }, []);

  return <div ref={containerRef} style={{ width: '100vw', height: '100vh' }} />;
};

export default VrmViewer;