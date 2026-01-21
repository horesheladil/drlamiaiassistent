
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage } from '@google/genai';
import { decode, decodeAudioData, createPcmBlob, blobToBase64 } from './utils/audio-utils';
import { AssistantMode } from './types';

// CORE BRAND ASSETS
const ASSETS = {
  LOGO: 'input_file_19.png',
  HERO: 'input_file_0.png',
  ICON: 'input_file_20.png',
  OFFICE: 'input_file_9.png',
  BANNER: 'input_file_15.png',
  PORTRAIT_RED: 'input_file_2.png',
  PORTRAIT_NAVY: 'input_file_4.png',
  STAGE: 'input_file_1.png',
  SPEARS_NOMINATION: 'input_file_3.png',
};

const App: React.FC = () => {
  const [isAiActive, setIsAiActive] = useState(false);
  const [aiMode, setAiMode] = useState<AssistantMode>('idle');
  const [scrolled, setScrolled] = useState(false);
  const [showDevGuide, setShowDevGuide] = useState(false);
  
  const audioContextInRef = useRef<AudioContext | null>(null);
  const audioContextOutRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const streamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameIntervalRef = useRef<number | null>(null);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 50);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const stopAiSession = useCallback(() => {
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    if (screenStreamRef.current) screenStreamRef.current.getTracks().forEach(t => t.stop());
    if (frameIntervalRef.current) clearInterval(frameIntervalRef.current);
    sourcesRef.current.forEach(s => { try { s.stop(); } catch(e) {} });
    sourcesRef.current.clear();
    setAiMode('idle');
    setIsAiActive(false);
  }, []);

  const startAiSession = async () => {
    try {
      setIsAiActive(true);
      setAiMode('connecting');
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      audioContextInRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      audioContextOutRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      
      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = micStream;

      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        screenStreamRef.current = screenStream;
      } catch (err) { console.warn("Screen share declined."); }

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
          systemInstruction: `You are Dr. Ronit Lami, a premier wealth psychologist. You are speaking with a high-net-worth client during a virtual advisory session. Provide high-status, clinically insightful, and sophisticated psychological guidance on wealth dynamics and the Legacy ReCode™. Use the client's screen context if available. Be authoritative, calm, and concise. Do not use conversational filler.`,
        },
        callbacks: {
          onopen: () => {
            setAiMode('listening');
            const source = audioContextInRef.current!.createMediaStreamSource(micStream);
            const scriptProcessor = audioContextInRef.current!.createScriptProcessor(4096, 1, 1);
            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              sessionPromise.then(s => s.sendRealtimeInput({ media: createPcmBlob(inputData) }));
            };
            source.connect(scriptProcessor);
            scriptProcessor.connect(audioContextInRef.current!.destination);

            if (screenStreamRef.current && canvasRef.current) {
              const video = document.createElement('video');
              video.srcObject = screenStreamRef.current;
              video.play();
              const ctx = canvasRef.current.getContext('2d');
              frameIntervalRef.current = window.setInterval(() => {
                if (ctx && video.readyState === video.HAVE_ENOUGH_DATA) {
                  canvasRef.current!.width = 1024;
                  canvasRef.current!.height = 576;
                  ctx.drawImage(video, 0, 0, 1024, 576);
                  canvasRef.current!.toBlob(async (blob) => {
                    if (blob) {
                      const base64 = await blobToBase64(blob);
                      sessionPromise.then(s => s.sendRealtimeInput({ media: { data: base64, mimeType: 'image/jpeg' } }));
                    }
                  }, 'image/jpeg', 0.5);
                }
              }, 2000);
            }
          },
          onmessage: async (m) => {
            const data = m.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (data && audioContextOutRef.current) {
              const ctx = audioContextOutRef.current;
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
              const buf = await decodeAudioData(decode(data), ctx, 24000, 1);
              const s = ctx.createBufferSource();
              s.buffer = buf;
              s.connect(ctx.destination);
              s.onended = () => {
                sourcesRef.current.delete(s);
                if (sourcesRef.current.size === 0) setAiMode('listening');
              };
              s.start(nextStartTimeRef.current);
              nextStartTimeRef.current += buf.duration;
              sourcesRef.current.add(s);
              setAiMode('speaking');
            }
          },
          onclose: () => stopAiSession()
        }
      });
    } catch (e) { stopAiSession(); }
  };

  return (
    <div className="min-h-screen bg-brand-ivory text-brand-dark selection:bg-brand-amber selection:text-white">
      <canvas ref={canvasRef} className="hidden" />

      {/* NAVIGATION */}
      <nav className={`fixed top-0 w-full z-[80] transition-custom h-24 flex items-center ${scrolled ? 'bg-white/95 backdrop-blur-xl border-b border-brand-dark/5 shadow-sm' : 'bg-transparent'}`}>
        <div className="max-w-7xl mx-auto px-8 w-full flex justify-between items-center">
          <img src={ASSETS.LOGO} alt="Dr. Ronit Lami" className="h-9 w-auto hover:opacity-80 transition-opacity cursor-pointer" />
          <div className="hidden lg:flex items-center space-x-12">
            {['Expertise', 'The ReCode', 'Media', 'Insights'].map(item => (
              <a key={item} href="#" className="text-[10px] font-bold uppercase tracking-[0.4em] text-brand-dark hover:text-brand-amber transition-colors">
                {item}
              </a>
            ))}
            <button 
              onClick={startAiSession}
              className="bg-brand-dark text-white px-9 py-3 rounded-sm text-[10px] font-bold uppercase tracking-[0.3em] hover:bg-brand-orange transition-all duration-300 shadow-lg"
            >
              Virtual Advisory
            </button>
          </div>
        </div>
      </nav>

      {/* HERO SECTION */}
      <section className="relative h-screen flex items-center overflow-hidden bg-brand-dark">
        <div className="absolute inset-0">
           <img src={ASSETS.BANNER} className="w-full h-full object-cover opacity-20 grayscale" alt="" />
           <div className="absolute inset-0 bg-gradient-to-r from-brand-dark via-brand-dark/90 to-transparent" />
        </div>
        
        <div className="relative z-10 max-w-7xl mx-auto px-8 w-full grid lg:grid-cols-2 gap-20 items-center">
          <div className="animate-up">
            <h1 className="text-white text-5xl md:text-[5.5rem] font-bold leading-[1.05] mb-10 tracking-tight">
              Dr. Ronit Lami <br/>
              <span className="gold-gradient italic font-normal">Global Expert in <br/>Generational Wealth</span>
            </h1>
            <p className="text-white/50 text-xl font-light leading-relaxed max-w-lg mb-16 tracking-wide">
              I help families leverage financial success to bring family harmony, prepare for inheritance, create meaningful legacy, and build relationships that thrive, not just survive.
            </p>
            <div className="flex gap-8">
              <button onClick={startAiSession} className="bg-brand-yellow text-brand-dark px-12 py-5 text-[11px] font-bold uppercase tracking-[0.4em] hover:bg-white transition-all duration-500 shadow-xl">
                Virtual Advisory Mode
              </button>
              <button className="border border-white/20 text-white px-12 py-5 text-[11px] font-bold uppercase tracking-[0.4em] hover:bg-white/5 transition-all">
                The ReCode™
              </button>
            </div>
          </div>
          <div className="hidden lg:block relative animate-up" style={{ animationDelay: '0.2s' }}>
             <div className="relative group">
                <div className="absolute -inset-4 border border-brand-yellow/30 group-hover:-inset-6 transition-all duration-700" />
                <img src={ASSETS.HERO} className="relative z-10 w-full h-auto shadow-[0_50px_100px_-20px_rgba(0,0,0,0.5)] transition-all duration-1000 grayscale group-hover:grayscale-0" alt="Dr. Ronit Lami" />
             </div>
          </div>
        </div>
      </section>

      {/* MEDIA PARTNERS */}
      <section className="py-24 bg-brand-ivory border-b border-brand-slate/10">
        <div className="max-w-7xl mx-auto px-8">
           <div className="flex flex-wrap justify-center items-center gap-20 md:gap-32 opacity-70 hover:opacity-100 transition-opacity grayscale hover:grayscale-0">
              <img src="https://img.logo.dev/apa.org?token=pk_mXWvU_9XQ_q9I7_T9zI_Qw" className="h-12 w-auto" alt="APA" />
              <img src="https://img.logo.dev/bps.org.uk?token=pk_mXWvU_9XQ_q9I7_T9zI_Qw" className="h-12 w-auto" alt="BPS" />
              <img src="https://img.logo.dev/psychologytoday.com?token=pk_mXWvU_9XQ_q9I7_T9zI_Qw" className="h-12 w-auto" alt="Psychology Today" />
              <img src="https://img.logo.dev/licensedpsychologist.com?token=pk_mXWvU_9XQ_q9I7_T9zI_Qw" className="h-12 w-auto" alt="Licensed Psychologist" />
           </div>
        </div>
      </section>

      {/* THE STORY */}
      <section className="py-48 bg-white overflow-hidden">
        <div className="max-w-4xl mx-auto px-8">
           <div className="space-y-16 animate-up">
              <div className="w-24 h-1.5 bg-brand-orange" />
              <h2 className="text-4xl md:text-5xl font-light italic leading-tight text-brand-dark">
                "Four siblings inherited a multibillion-dollar company but couldn't make a single decision without every meeting erupting into accusations and chaos..."
              </h2>
              <div className="grid md:grid-cols-2 gap-20 pt-16 border-t border-brand-slate/10">
                 <div className="space-y-10">
                    <p className="text-xl font-light leading-relaxed text-brand-dark/70">
                       Within a year of our work, the brother who felt invisible became a productive partner, the sister who carried everything alone learned to release control, and the family stopped fighting about power and started building something that could last.
                    </p>
                 </div>
                 <div className="space-y-10">
                    <div className="pt-8 p-10 bg-brand-dark text-white relative">
                       <div className="absolute top-0 right-0 w-2 h-full bg-brand-yellow" />
                       <p className="font-bold text-brand-yellow tracking-[0.3em] text-[11px] uppercase mb-4">Authority & Credentials</p>
                       <p className="text-sm font-light leading-loose tracking-widest opacity-80 uppercase">
                          PhD in Clinical Psychology <br/> 20+ Years Clinical Experience <br/> International Speaker on The Psychology of Wealth
                       </p>
                    </div>
                 </div>
              </div>
           </div>
        </div>
      </section>

      {/* CORE OFFERINGS */}
      <section className="py-48 bg-brand-ivory">
        <div className="max-w-7xl mx-auto px-8">
           <div className="text-center mb-32">
              <h3 className="gold-gradient text-[11px] font-bold uppercase tracking-[0.6em] mb-8">Service Portfolio</h3>
              <h4 className="text-6xl font-light tracking-tight text-brand-dark">Core Offerings</h4>
           </div>
           <div className="grid md:grid-cols-2 gap-12">
              {[
                { t: 'Family & Family Business Advisory', d: 'Enhance communication, resolve conflict, and align across generations with expert guidance.', c: '#F2C230' },
                { t: 'Ultra Elite Process', d: 'The Legacy ReCode™ Year-long bespoke engagement to align wealth with values, relationships, and legacy.', c: '#F2921D' },
                { t: 'Wealth Transfer Readiness', d: 'Navigate emotional and financial complexities for seamless generational transitions.', c: '#F24F13' },
                { t: 'Speaking & Education Programs', d: 'Thought-leading speaking engagements on the psychology of wealth for families and institutions.', c: '#8082A6' }
              ].map((item, idx) => (
                <div key={idx} className="bg-white p-16 border-l-[10px] shadow-sm hover:shadow-2xl transition-custom group cursor-pointer" style={{ borderLeftColor: item.c }}>
                   <h5 className="text-3xl font-light mb-8 tracking-tight group-hover:text-brand-amber transition-colors">{item.t}</h5>
                   <p className="text-brand-slate text-lg leading-relaxed font-light mb-12">{item.d}</p>
                   <button className="text-[10px] font-bold uppercase tracking-[0.4em] text-brand-dark border-b-2 border-brand-dark/10 pb-2 group-hover:border-brand-amber transition-all">Read More</button>
                </div>
              ))}
           </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="bg-brand-dark pt-48 pb-24 text-white">
        <div className="max-w-7xl mx-auto px-8">
           <div className="grid lg:grid-cols-12 gap-24 mb-32">
              <div className="lg:col-span-5 space-y-16">
                 <img src={ASSETS.LOGO} className="h-10 brightness-0 invert" alt="Lami" />
                 <p className="text-brand-slate text-xl leading-relaxed font-light italic opacity-60">
                    Helping families turn financial success into stability, continuity, and relationships that thrive.
                 </p>
                 <div className="flex gap-10">
                    {['LinkedIn', 'Instagram', 'Email'].map(social => (
                       <span key={social} className="text-[10px] font-bold uppercase tracking-[0.4em] text-white/30 hover:text-brand-yellow cursor-pointer transition-colors">{social}</span>
                    ))}
                 </div>
              </div>
              <div className="lg:col-span-7 flex justify-end items-end">
                <button 
                  onClick={() => setShowDevGuide(!showDevGuide)}
                  className="text-[10px] font-bold uppercase tracking-[0.4em] text-white/10 hover:text-brand-yellow transition-colors border border-white/5 px-4 py-2"
                >
                  Implementation Docs
                </button>
              </div>
           </div>

           <div className="pt-20 border-t border-white/5 flex flex-col md:flex-row justify-between items-center gap-16">
              <div className="flex gap-20 opacity-20 hover:opacity-100 transition-opacity grayscale invert">
                 <img src={ASSETS.SPEARS_NOMINATION} className="h-20 w-auto" alt="Spears Award" />
                 <img src={ASSETS.ICON} className="h-16 w-auto" alt="Brand Icon" />
              </div>
              <p className="text-[9px] font-bold uppercase tracking-[0.5em] text-white/10">
                 © 2025 Dr. Ronit Lami | Global Expert in Generational Wealth Psychology™
              </p>
           </div>
        </div>
      </footer>

      {/* ADVISORY OVERLAY */}
      {isAiActive && (
        <div className="fixed inset-0 z-[100] bg-brand-dark/95 backdrop-blur-3xl flex items-center justify-center p-8 animate-up">
           <div className="w-full max-w-2xl bg-white p-20 text-center card-shadow border-t-[10px] border-brand-yellow relative overflow-hidden">
              <div className="relative inline-block mb-16">
                 <div className={`absolute -inset-10 border border-brand-yellow/20 rounded-full transition-all duration-1000 ${aiMode === 'speaking' ? 'scale-150 opacity-0' : 'scale-100 opacity-100'}`} />
                 <div className={`relative w-40 h-40 rounded-full bg-brand-dark flex items-center justify-center transition-all duration-500 ${aiMode === 'speaking' ? 'scale-105' : ''}`}>
                    <img src={ASSETS.ICON} className="w-16 grayscale brightness-200" alt="" />
                 </div>
              </div>
              <h3 className="text-4xl font-light text-brand-dark mb-4 tracking-tight">Executive Advisory Session</h3>
              <p className="text-brand-amber text-[10px] font-bold uppercase tracking-[1em] mb-16 h-4">
                 {aiMode === 'listening' ? 'Listening...' : aiMode === 'speaking' ? 'Sharing Insights...' : 'Connecting...'}
              </p>
              <div className="flex justify-center gap-6">
                 <button onClick={stopAiSession} className="bg-brand-dark text-white px-20 py-6 text-[11px] font-bold uppercase tracking-[0.4em] hover:bg-brand-orange transition-all duration-500 shadow-2xl">
                    Terminate Session
                 </button>
              </div>
           </div>
        </div>
      )}

      {/* DEV IMPLEMENTATION GUIDE */}
      {showDevGuide && (
        <div className="fixed inset-0 z-[200] bg-brand-dark/90 backdrop-blur-xl flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-3xl p-12 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-12">
              <h2 className="text-2xl font-bold uppercase tracking-widest text-brand-dark">Production Deployment Guide</h2>
              <button onClick={() => setShowDevGuide(false)} className="text-brand-slate hover:text-brand-orange">✕ Close</button>
            </div>
            
            <div className="space-y-8 text-sm leading-relaxed text-brand-dark/80">
              <div className="p-6 bg-brand-ivory border-l-4 border-brand-amber">
                <p className="font-bold text-brand-amber uppercase tracking-widest text-[10px] mb-2">Step 1: Hosting</p>
                <p>Deploy this React project to <strong>Vercel</strong> or <strong>Netlify</strong>. Connect your GitHub repository for automatic builds.</p>
              </div>

              <div className="p-6 bg-brand-ivory border-l-4 border-brand-orange">
                <p className="font-bold text-brand-orange uppercase tracking-widest text-[10px] mb-2">Step 2: API Security</p>
                <p>In production, do not hardcode the API key. Use <strong>Google Cloud API Restrictions</strong> to limit the key usage to Dr. Lami's domain only (HTTP Referrer restriction).</p>
              </div>

              <div className="space-y-4">
                <p className="font-bold uppercase tracking-widest text-[10px]">Step 3: Embed Snippet</p>
                <pre className="bg-brand-dark text-brand-ivory p-6 rounded-lg text-xs overflow-x-auto">
{`<!-- Add this to Dr. Lami's Website HTML -->
<iframe 
  src="https://your-deployed-advisory.vercel.app" 
  allow="microphone; display-capture" 
  style="width: 100%; height: 100vh; border: none;">
</iframe>`}
                </pre>
              </div>

              <div className="pt-8 border-t border-brand-slate/10 text-[10px] uppercase tracking-widest opacity-50">
                Contact Engineering for Advanced Web Component Bundling (r2wc).
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
