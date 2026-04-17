import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import './GeminiVoicePage.css';

type ChatRole = 'user' | 'assistant';
type LlmProvider = 'gemini' | 'anthropic';

interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
}

declare global {
  interface Window {
    webkitSpeechRecognition?: new () => SpeechRecognition;
    SpeechRecognition?: new () => SpeechRecognition;
  }
}

interface SpeechRecognitionEventResult {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  0: SpeechRecognitionEventResult;
  isFinal: boolean;
  length: number;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: SpeechRecognitionResultLike[];
}

interface SpeechRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

const API_KEY_STORAGE = 'gemini_api_key_local';
const GEMINI_MODEL_STORAGE = 'gemini_model_local';
const LLM_PROVIDER_STORAGE = 'llm_provider_local';

const ANTHROPIC_TOKEN_STORAGE = 'anthropic_auth_token_local';
const ANTHROPIC_BASE_URL_STORAGE = 'anthropic_base_url_local';
const ANTHROPIC_MODEL_STORAGE = 'anthropic_model_local';
const VOICE_URI_STORAGE = 'tts_voice_uri_local';
const VOICE_RATE_STORAGE = 'tts_voice_rate_local';
const VOICE_PITCH_STORAGE = 'tts_voice_pitch_local';
const VOICE_VOLUME_STORAGE = 'tts_voice_volume_local';

const DEFAULT_GEMINI_MODEL = 'gemini-2.0-flash';
const DEFAULT_ANTHROPIC_BASE_URL = 'https://coding.dashscope.aliyuncs.com/apps/anthropic';
const DEFAULT_ANTHROPIC_MODEL = 'qwen3.6-plus';
const DEFAULT_MAX_OUTPUT_TOKENS = 1024;

const WELCOME_MESSAGES: ChatMessage[] = [
  {
    id: 'welcome-1',
    role: 'assistant',
    text: '欢迎来到 Gemini 语音页。先填入 API Key，然后点击“开始语音输入”即可和大模型语音对话。',
  },
];

function buildGeminiContents(messages: ChatMessage[]) {
  return messages.map((message) => ({
    role: message.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: message.text }],
  }));
}

function normalizeGeminiText(data: unknown): string {
  if (!data || typeof data !== 'object') {
    return '';
  }

  const root = data as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };

  const candidate = root.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  return parts
    .map((part) => (typeof part.text === 'string' ? part.text : ''))
    .join('\n')
    .trim();
}

function normalizeAnthropicText(data: unknown): string {
  if (!data || typeof data !== 'object') {
    return '';
  }

  const root = data as {
    content?: Array<{ type?: string; text?: string }>;
  };

  const content = root.content ?? [];
  return content
    .filter((item) => item.type === 'text')
    .map((item) => item.text ?? '')
    .join('\n')
    .trim();
}

function buildProviderErrorMessage(provider: LlmProvider, status: number, detail: string): string {
  const low = detail.toLowerCase();
  const isCreditIssue =
    status === 429 &&
    (low.includes('resource_exhausted') ||
      low.includes('prepayment credits are depleted') ||
      low.includes('billing'));

  if (isCreditIssue) {
    if (provider === 'gemini') {
      return 'Gemini 暂不可用：当前项目额度或预充值余额已用尽。请到 https://ai.studio/projects 检查项目 billing 并充值后重试。';
    }
    return 'Anthropic 兼容接口暂不可用：额度或计费资源可能已耗尽，请检查对应平台项目账单。';
  }

  if (status === 401 || status === 403) {
    if (provider === 'gemini') {
      return 'Gemini 鉴权失败：请检查 API Key 是否正确、是否属于当前项目、以及项目权限是否开启。';
    }
    return 'Anthropic 兼容接口鉴权失败：请检查 AUTH TOKEN、BASE URL、MODEL 是否正确。';
  }

  if (status === 429) {
    return `${provider === 'gemini' ? 'Gemini' : 'Anthropic 兼容接口'} 请求过于频繁（429）。请稍后重试。`;
  }

  if (status >= 500) {
    return `${provider === 'gemini' ? 'Gemini' : 'Anthropic 兼容接口'} 服务端异常，请稍后重试。`;
  }

  return `${provider === 'gemini' ? 'Gemini' : 'Anthropic 兼容接口'} 请求失败：${status} ${detail}`;
}

function splitForSpeech(text: string, maxLen = 120): string[] {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) {
    return [];
  }

  const rough = cleaned
    .split(/(?<=[。！？!?；;，,\.])/)
    .map((item) => item.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  for (const piece of rough) {
    if (piece.length <= maxLen) {
      chunks.push(piece);
      continue;
    }

    for (let start = 0; start < piece.length; start += maxLen) {
      chunks.push(piece.slice(start, start + maxLen));
    }
  }

  return chunks;
}

function GeminiVoicePage() {
  const [provider, setProvider] = useState<LlmProvider>(() => {
    const saved = localStorage.getItem(LLM_PROVIDER_STORAGE);
    return saved === 'anthropic' ? 'anthropic' : 'gemini';
  });

  const [apiKey, setApiKey] = useState<string>(() => localStorage.getItem(API_KEY_STORAGE) ?? '');
  const [geminiModel, setGeminiModel] = useState<string>(() => localStorage.getItem(GEMINI_MODEL_STORAGE) ?? DEFAULT_GEMINI_MODEL);

  const [anthropicToken, setAnthropicToken] = useState<string>(() => localStorage.getItem(ANTHROPIC_TOKEN_STORAGE) ?? '');
  const [anthropicBaseUrl, setAnthropicBaseUrl] = useState<string>(() => localStorage.getItem(ANTHROPIC_BASE_URL_STORAGE) ?? DEFAULT_ANTHROPIC_BASE_URL);
  const [anthropicModel, setAnthropicModel] = useState<string>(() => localStorage.getItem(ANTHROPIC_MODEL_STORAGE) ?? DEFAULT_ANTHROPIC_MODEL);

  const [messages, setMessages] = useState<ChatMessage[]>(WELCOME_MESSAGES);
  const [inputText, setInputText] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [lastAssistantText, setLastAssistantText] = useState('');
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceUri, setVoiceUri] = useState<string>(() => localStorage.getItem(VOICE_URI_STORAGE) ?? '');
  const [voiceRate, setVoiceRate] = useState<number>(() => Number(localStorage.getItem(VOICE_RATE_STORAGE) ?? '1'));
  const [voicePitch, setVoicePitch] = useState<number>(() => Number(localStorage.getItem(VOICE_PITCH_STORAGE) ?? '1'));
  const [voiceVolume, setVoiceVolume] = useState<number>(() => Number(localStorage.getItem(VOICE_VOLUME_STORAGE) ?? '1'));
  const [ttsStatusText, setTtsStatusText] = useState('');

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const speakSessionRef = useRef(0);

  const isSpeechSynthesisSupported = useMemo(() => {
    return Boolean(window.speechSynthesis && window.SpeechSynthesisUtterance);
  }, []);

  const isSpeechRecognitionSupported = useMemo(() => {
    return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
  }, []);

  useEffect(() => {
    if (!isSpeechSynthesisSupported) {
      return;
    }

    const loadVoices = () => {
      const list = window.speechSynthesis.getVoices();
      const sorted = [...list].sort((a, b) => {
        const azh = a.lang.toLowerCase().includes('zh') ? 0 : 1;
        const bzh = b.lang.toLowerCase().includes('zh') ? 0 : 1;
        if (azh !== bzh) {
          return azh - bzh;
        }
        return a.name.localeCompare(b.name);
      });

      setVoices(sorted);

      if (!voiceUri && sorted.length > 0) {
        const preferred = sorted.find((voice) => voice.lang.toLowerCase().includes('zh')) ?? sorted[0];
        setVoiceUri(preferred.voiceURI);
      }
    };

    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;

    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, [isSpeechSynthesisSupported, voiceUri]);

  const speakText = (message: string) => {
    if (!isSpeechSynthesisSupported || !message.trim()) {
      setTtsStatusText('当前浏览器不支持语音播报（SpeechSynthesis）。');
      return false;
    }

    const runtimeVoices = window.speechSynthesis.getVoices();
    if (runtimeVoices.length === 0) {
      setTtsStatusText('未检测到系统语音包。请稍等 2-3 秒后重试，或检查系统是否安装语音。');
      return false;
    }

    const chunks = splitForSpeech(message, 120);
    if (chunks.length === 0) {
      setTtsStatusText('播报文本为空。');
      return false;
    }

    const selectedVoice = voices.find((voice) => voice.voiceURI === voiceUri);
    const sessionId = speakSessionRef.current + 1;
    speakSessionRef.current = sessionId;

    const speakChunk = (index: number) => {
      if (speakSessionRef.current !== sessionId) {
        return;
      }

      if (index >= chunks.length) {
        setTtsStatusText('播报完成。');
        return;
      }

      const utterance = new SpeechSynthesisUtterance(chunks[index]);
      utterance.lang = 'zh-CN';
      utterance.rate = Math.max(0.5, Math.min(2, voiceRate));
      utterance.pitch = Math.max(0, Math.min(2, voicePitch));
      utterance.volume = Math.max(0, Math.min(1, voiceVolume));

      if (selectedVoice) {
        utterance.voice = selectedVoice;
        utterance.lang = selectedVoice.lang;
      }

      utterance.onstart = () => {
        if (index === 0) {
          setTtsStatusText(selectedVoice
            ? `正在播报（${selectedVoice.name} / ${selectedVoice.lang}）`
            : '正在播报（默认系统音色）');
        }
      };

      utterance.onend = () => {
        speakChunk(index + 1);
      };

      utterance.onerror = (event) => {
        const code = event.error ?? '';

        if (code === 'interrupted' || code === 'canceled') {
          setTtsStatusText('上一段播报已中断，已切换到最新内容。');
          return;
        }

        const detail = code ? `错误码：${code}` : '未返回错误码';
        setErrorText(`语音播报失败（${detail}）。请先点“测试音色”进行用户手势解锁，或更换音色后重试。`);
        setTtsStatusText('播报失败。常见原因：自动播放限制、音色不可用、系统语音服务异常。');
      };

      window.speechSynthesis.speak(utterance);
    };

    window.speechSynthesis.cancel();
    speakChunk(0);
    return true;
  };

  const saveConfig = () => {
    localStorage.setItem(LLM_PROVIDER_STORAGE, provider);
    localStorage.setItem(API_KEY_STORAGE, apiKey.trim());
    localStorage.setItem(GEMINI_MODEL_STORAGE, geminiModel.trim() || DEFAULT_GEMINI_MODEL);

    localStorage.setItem(ANTHROPIC_TOKEN_STORAGE, anthropicToken.trim());
    localStorage.setItem(ANTHROPIC_BASE_URL_STORAGE, anthropicBaseUrl.trim() || DEFAULT_ANTHROPIC_BASE_URL);
    localStorage.setItem(ANTHROPIC_MODEL_STORAGE, anthropicModel.trim() || DEFAULT_ANTHROPIC_MODEL);

    localStorage.setItem(VOICE_URI_STORAGE, voiceUri);
    localStorage.setItem(VOICE_RATE_STORAGE, String(voiceRate));
    localStorage.setItem(VOICE_PITCH_STORAGE, String(voicePitch));
    localStorage.setItem(VOICE_VOLUME_STORAGE, String(voiceVolume));

    setErrorText('模型配置已保存到本地浏览器。');
  };

  const sendToModel = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isSending) {
      return;
    }

    if (provider === 'gemini' && !apiKey.trim()) {
      setErrorText('请先输入 Gemini API Key。');
      return;
    }

    if (provider === 'anthropic' && (!anthropicToken.trim() || !anthropicBaseUrl.trim() || !anthropicModel.trim())) {
      setErrorText('请先填写 Anthropic 兼容接口的 Token / Base URL / Model。');
      return;
    }

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      text: trimmed,
    };

    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInputText('');
    setInterimTranscript('');
    setIsSending(true);
    setErrorText('');

    try {
      const callProvider = async (requestMessages: ChatMessage[]) => {
        let response: Response;
        if (provider === 'gemini') {
          response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(geminiModel.trim() || DEFAULT_GEMINI_MODEL)}:generateContent?key=${apiKey.trim()}`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                contents: buildGeminiContents(requestMessages),
                generationConfig: {
                  temperature: 0.7,
                  maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
                },
              }),
            },
          );
        } else {
          const base = anthropicBaseUrl.trim().replace(/\/+$/, '');
          response = await fetch(`${base}/v1/messages`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': anthropicToken.trim(),
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
              model: anthropicModel.trim(),
              max_tokens: DEFAULT_MAX_OUTPUT_TOKENS,
              temperature: 0.7,
              messages: requestMessages.map((message) => ({
                role: message.role,
                content: message.text,
              })),
            }),
          });
        }

        if (!response.ok) {
          const detail = await response.text();
          throw new Error(buildProviderErrorMessage(provider, response.status, detail));
        }

        const data = (await response.json()) as unknown;
        const textReply = provider === 'gemini' ? normalizeGeminiText(data) : normalizeAnthropicText(data);

        let tokenLimited = false;
        if (provider === 'gemini') {
          const root = data as { candidates?: Array<{ finishReason?: string }> };
          tokenLimited = root.candidates?.[0]?.finishReason === 'MAX_TOKENS';
        } else {
          const root = data as { stop_reason?: string };
          tokenLimited = root.stop_reason === 'max_tokens';
        }

        return {
          textReply,
          tokenLimited,
        };
      };

      const first = await callProvider(nextMessages);
      let fullReply = first.textReply;

      // 当服务端因 token 上限截断时自动续写一次，减少“只输出前半句”的体感。
      if (first.tokenLimited && fullReply.trim()) {
        const continuePrompt: ChatMessage = {
          id: `continue-${Date.now()}`,
          role: 'user',
          text: '请从你上一条回复被截断的位置继续输出，不要重复前文。',
        };

        const second = await callProvider([...nextMessages, {
          id: `assistant-partial-${Date.now()}`,
          role: 'assistant',
          text: fullReply,
        }, continuePrompt]);

        if (second.textReply.trim()) {
          fullReply = `${fullReply}\n${second.textReply}`.trim();
        }
      }

      const assistantMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        text: fullReply || '模型返回为空，请稍后重试。',
      };

      setMessages((prev) => [...prev, assistantMessage]);
      setLastAssistantText(assistantMessage.text);
      if (autoSpeak) {
        const ok = speakText(assistantMessage.text);
        if (!ok) {
          setErrorText('回复已生成，但自动播报未开始。请先点击“测试音色”，再使用“重播最近回复”。');
        }
      }
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSending(false);
    }
  };

  const onSubmitText = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await sendToModel(inputText);
  };

  const startSpeechRecognition = () => {
    if (!isSpeechRecognitionSupported) {
      setErrorText('当前浏览器不支持语音识别。请使用 Chrome/Edge。');
      return;
    }

    if (isListening) {
      return;
    }

    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      setErrorText('未检测到 SpeechRecognition。');
      return;
    }

    const recognition = new Recognition();
    recognition.lang = 'zh-CN';
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      let finalText = '';
      let interimText = '';

      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const transcript = result?.[0]?.transcript ?? '';
        if (result.isFinal) {
          finalText += transcript;
        } else {
          interimText += transcript;
        }
      }

      setInterimTranscript(interimText.trim());

      if (finalText.trim()) {
        void sendToModel(finalText.trim());
      }
    };

    recognition.onerror = (event) => {
      setErrorText(`语音识别错误：${event.error}`);
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
      setInterimTranscript('');
    };

    recognitionRef.current = recognition;
    setErrorText('');
    setIsListening(true);
    recognition.start();
  };

  const stopSpeechRecognition = () => {
    recognitionRef.current?.stop();
    setIsListening(false);
  };

  const stopSpeaking = () => {
    window.speechSynthesis?.cancel();
  };

  return (
    <div className='voice-page'>
      <header className='voice-header'>
        <div>
          <h1>Voice Studio</h1>
          <p>麦克风输入 → 大模型回复 → 语音播报，全链路语音助手页</p>
        </div>
        <a className='back-link' href='/'>返回动作页</a>
      </header>

      <section className='voice-config-card'>
        <label htmlFor='provider'>模型提供商</label>
        <div className='api-row'>
          <select id='provider' value={provider} onChange={(event) => setProvider(event.target.value as LlmProvider)}>
            <option value='gemini'>Gemini</option>
            <option value='anthropic'>Anthropic 兼容（DashScope 代理）</option>
          </select>
        </div>

        {provider === 'gemini' ? (
          <>
            <label htmlFor='apiKey'>Gemini API Key</label>
            <div className='api-row'>
              <input
                id='apiKey'
                type='password'
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder='AIza...'
              />
            </div>
            <label htmlFor='geminiModel'>Gemini Model</label>
            <div className='api-row'>
              <input
                id='geminiModel'
                type='text'
                value={geminiModel}
                onChange={(event) => setGeminiModel(event.target.value)}
                placeholder='gemini-2.0-flash'
              />
            </div>
          </>
        ) : (
          <>
            <label htmlFor='anthropicToken'>ANTHROPIC_AUTH_TOKEN</label>
            <div className='api-row'>
              <input
                id='anthropicToken'
                type='password'
                value={anthropicToken}
                onChange={(event) => setAnthropicToken(event.target.value)}
                placeholder='sk-...'
              />
            </div>

            <label htmlFor='anthropicBase'>ANTHROPIC_BASE_URL</label>
            <div className='api-row'>
              <input
                id='anthropicBase'
                type='text'
                value={anthropicBaseUrl}
                onChange={(event) => setAnthropicBaseUrl(event.target.value)}
                placeholder='https://coding.dashscope.aliyuncs.com/apps/anthropic'
              />
            </div>

            <label htmlFor='anthropicModel'>ANTHROPIC_MODEL</label>
            <div className='api-row'>
              <input
                id='anthropicModel'
                type='text'
                value={anthropicModel}
                onChange={(event) => setAnthropicModel(event.target.value)}
                placeholder='qwen3.6-plus'
              />
            </div>
          </>
        )}

        <div className='api-row'>
          <button type='button' onClick={saveConfig}>保存配置</button>
        </div>
        <p>提示：Key 仅保存在本地浏览器。生产环境建议走后端代理，不要前端直连。</p>
      </section>

      <section className='voice-controls'>
        <button type='button' className='mic-btn' onClick={startSpeechRecognition} disabled={isListening || isSending}>
          {isListening ? '识别中...' : '开始语音输入'}
        </button>
        <button type='button' className='secondary-btn' onClick={stopSpeechRecognition} disabled={!isListening}>
          停止语音输入
        </button>
        <button type='button' className='secondary-btn' onClick={stopSpeaking}>
          停止播报
        </button>
        <label className='switch'>
          <input type='checkbox' checked={autoSpeak} onChange={(event) => setAutoSpeak(event.target.checked)} />
          自动播报回复
        </label>
      </section>

      {ttsStatusText && <div className='interim-box'>{ttsStatusText}</div>}

      <section className='voice-config-card'>
        <label htmlFor='voiceSelect'>语音音色</label>
        <div className='api-row'>
          <select
            id='voiceSelect'
            value={voiceUri}
            onChange={(event) => setVoiceUri(event.target.value)}
            disabled={!isSpeechSynthesisSupported || voices.length === 0}
          >
            {voices.length === 0 && <option value=''>未检测到可用音色</option>}
            {voices.map((voice) => (
              <option key={voice.voiceURI} value={voice.voiceURI}>
                {voice.name} ({voice.lang})
              </option>
            ))}
          </select>
        </div>

        <label htmlFor='voiceRate'>语速: {voiceRate.toFixed(2)}</label>
        <div className='api-row'>
          <input
            id='voiceRate'
            type='range'
            min='0.5'
            max='2'
            step='0.05'
            value={voiceRate}
            onChange={(event) => setVoiceRate(Number(event.target.value))}
          />
        </div>

        <label htmlFor='voicePitch'>音调: {voicePitch.toFixed(2)}</label>
        <div className='api-row'>
          <input
            id='voicePitch'
            type='range'
            min='0'
            max='2'
            step='0.05'
            value={voicePitch}
            onChange={(event) => setVoicePitch(Number(event.target.value))}
          />
        </div>

        <label htmlFor='voiceVolume'>音量: {voiceVolume.toFixed(2)}</label>
        <div className='api-row'>
          <input
            id='voiceVolume'
            type='range'
            min='0'
            max='1'
            step='0.05'
            value={voiceVolume}
            onChange={(event) => setVoiceVolume(Number(event.target.value))}
          />
        </div>

        <div className='api-row'>
          <button type='button' onClick={() => speakText('你好，这是当前音色测试。')}>测试音色</button>
          <button type='button' onClick={() => speakText(lastAssistantText)} disabled={!lastAssistantText}>重播最近回复</button>
        </div>
        <p>提示：部分浏览器要求先用户交互后才允许播报声音；若无声，请先点“测试音色”。</p>
      </section>

      {interimTranscript && <div className='interim-box'>识别中：{interimTranscript}</div>}
      {errorText && <div className='error-box'>{errorText}</div>}

      <section className='chat-card'>
        <div className='messages'>
          {messages.map((message) => (
            <article key={message.id} className={`message ${message.role}`}>
              <header>{message.role === 'user' ? '你' : provider === 'gemini' ? 'Gemini' : 'Anthropic 兼容'}</header>
              <p>{message.text}</p>
            </article>
          ))}
        </div>

        <form className='input-row' onSubmit={onSubmitText}>
          <textarea
            value={inputText}
            onChange={(event) => setInputText(event.target.value)}
            placeholder='可手动输入文本后发送（备用）'
            rows={2}
          />
          <button type='submit' disabled={isSending}>{isSending ? '发送中...' : '发送'}</button>
        </form>
      </section>
    </div>
  );
}

export default GeminiVoicePage;
