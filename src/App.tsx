import VrmViewer from './VrmViewer'
import './App.css'
import { useEffect, useRef, useState } from 'react'
import type { ActionName, DebugState, MotionEvent, StreamEventType } from './vrmMotion'

const INITIAL_STATE: DebugState = {
  modelReady: false,
  currentAction: 'reset',
  lastErrorCode: null,
  events: [],
}

const EXPRESSIONS = ['happy', 'angry', 'sad', 'relaxed', 'surprised', 'neutral']

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false })
}

function pushStreamEvent(eventType: StreamEventType, chunkIndex = 0) {
  window.vrmStreamEvent?.(eventType, chunkIndex)
}

function App() {
  const [debugState, setDebugState] = useState<DebugState>(INITIAL_STATE)
  const streamTimerRef = useRef<number | null>(null)
  const idleTimerRef = useRef<number | null>(null)

  useEffect(() => {
    const handler = (event: Event) => {
      const customEvent = event as CustomEvent<DebugState>
      setDebugState(customEvent.detail)
    }

    window.addEventListener('vrm-state-change', handler)
    if (window.vrmDebugState) {
      setDebugState(window.vrmDebugState)
    }

    return () => {
      window.removeEventListener('vrm-state-change', handler)
      if (streamTimerRef.current) {
        window.clearInterval(streamTimerRef.current)
      }
      if (idleTimerRef.current) {
        window.clearTimeout(idleTimerRef.current)
      }
    }
  }, [])

  const startStreamSimulation = () => {
    if (streamTimerRef.current) {
      window.clearInterval(streamTimerRef.current)
      streamTimerRef.current = null
    }

    if (idleTimerRef.current) {
      window.clearTimeout(idleTimerRef.current)
      idleTimerRef.current = null
    }

    let chunkIndex = 0
    const totalChunks = 14

    streamTimerRef.current = window.setInterval(() => {
      chunkIndex += 1
      pushStreamEvent('chunk', chunkIndex)

      if (chunkIndex >= totalChunks) {
        if (streamTimerRef.current) {
          window.clearInterval(streamTimerRef.current)
          streamTimerRef.current = null
        }
        pushStreamEvent('sentence_end', chunkIndex)

        idleTimerRef.current = window.setTimeout(() => {
          pushStreamEvent('idle_timeout', chunkIndex)
          idleTimerRef.current = null
        }, 1200)
      }
    }, 220)
  }

  const stopStreamSimulation = () => {
    if (streamTimerRef.current) {
      window.clearInterval(streamTimerRef.current)
      streamTimerRef.current = null
    }

    if (idleTimerRef.current) {
      window.clearTimeout(idleTimerRef.current)
      idleTimerRef.current = null
    }

    pushStreamEvent('idle_timeout', 0)
  }

  const onAction = (action: ActionName) => {
    window.vrmAction?.(action)
  }

  const events: MotionEvent[] = [...debugState.events].reverse()

  return (
    <div className='app-shell'>
      <VrmViewer />

      <div className='header-overlay'>
        <h1>AI VTuber Motion Console</h1>
        <div style={{ marginTop: '8px' }}>
          <a
            href='/voice'
            style={{
              pointerEvents: 'auto',
              background: 'rgba(14,25,39,0.86)',
              color: '#d9e8ff',
              border: '1px solid rgba(170,196,219,0.32)',
              borderRadius: '999px',
              padding: '6px 12px',
              textDecoration: 'none',
              fontSize: '13px',
              fontWeight: 700,
            }}
          >
            进入 Gemini 语音页
          </a>
        </div>
        <div className='status-row'>
          <span className={debugState.modelReady ? 'ok' : 'warn'}>
            {debugState.modelReady ? 'Model: Ready' : 'Model: Loading'}
          </span>
          <span>Current Action: {debugState.currentAction}</span>
          <span>Last Error: {debugState.lastErrorCode ?? 'None'}</span>
        </div>
      </div>

      <aside className='control-panel'>
        <section>
          <h3>流式事件模拟</h3>
          <div className='button-grid two-col'>
            <button className='btn stream' onClick={startStreamSimulation}>开始模拟</button>
            <button className='btn stop' onClick={stopStreamSimulation}>停止并回正</button>
          </div>
          <p className='hint'>规则：chunk 触发 nod/wave，sentence_end 触发 nod，idle_timeout 触发 reset。</p>
        </section>

        <div>
          <h3>表情测试</h3>
          <div className='button-grid'>
            {EXPRESSIONS.map(expr => (
              <button
                key={expr}
                className='btn ghost'
                onClick={() => {
                  window.vrmExpression?.(expr, 1.0)
                }}
              >
                {expr}
              </button>
            ))}
            <button
              className='btn danger full'
              onClick={() => {
                window.vrmExpressionReset?.()
              }}
            >
              重置表情
            </button>
          </div>
        </div>

        <div>
          <h3>动作测试</h3>
          <div className='button-grid'>
            <button className='btn motion-wave' onClick={() => onAction('wave')}>
              挥挥右手
            </button>

            <button className='btn motion-nod' onClick={() => onAction('nod')}>
              点头 (脖子转动)
            </button>

            <button className='btn motion-shake' onClick={() => onAction('shake')}>
              摇头
            </button>

            <button className='btn motion-leftarm' onClick={() => onAction('raiseLeftArm')}>
              举起左臂
            </button>

            <button className='btn reset full' onClick={() => onAction('reset')}>
              重置姿势 (T-Pose/A-Pose)
            </button>
          </div>
        </div>
      </aside>

      <aside className='log-panel'>
        <h3>事件日志 (最新 20 条)</h3>
        <ul>
          {events.length === 0 && <li>等待事件...</li>}
          {events.map((evt, index) => (
            <li key={`${evt.ts}-${evt.code}-${index}`} className={evt.code.includes('REJECTED') || evt.code === 'BONE_MISSING' ? 'err' : ''}>
              <span className='time'>{formatTime(evt.ts)}</span>
              <span className='code'>{evt.code}</span>
              <span className='msg'>{evt.message}</span>
            </li>
          ))}
        </ul>
      </aside>

      <div id='debug-log' className='legacy-debug' aria-hidden='true'>
        兼容旧调试占位
      </div>
    </div>
  )
}

export default App
