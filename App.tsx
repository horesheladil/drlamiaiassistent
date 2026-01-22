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
    return () => {
      window.removeEventListener('scroll', handleScroll);
      stopAiSession();
    };
  }, []);

  const stopAiSession = useCallback(() => {
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    if (screenStreamRef.current) screenStreamRef.current.getTracks().forEach(t => t.stop());
    if (frameIntervalRef.current) clearInterval(frameIntervalRef.current);
    
    sourcesRef.current.forEach(s => { 
      try { s.stop(); } catch(e) {} 
    });
    sourcesRef.current.clear();
    
    if (audioContextInRef.current) audioContextInRef.current.close();
    if (audioContextOutRef.current) audioContextOutRef.current.close();
    
    setAiMode('idle');
    setIsAiActive(false);
    nextStartTimeRef.current = 0;
  }, []);

  const startAiSession = async () => {
    try {
      setIsAiActive(true);
      setAiMode('connecting');
      
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
      
      const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
      audioContextInRef.current = new AudioCtx({ sampleRate: 16000 });
      audioContextOutRef.current = new AudioCtx({ sampleRate: 24000 });
      
      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = micStream;

      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        screenStreamRef.current = screenStream;
      } catch (err) { 
        console.warn("Screen share declined, continuing with voice only."); 
      }

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { 
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } 
          },
          systemInstruction: 'You are Dr. Ronit Lami, a premier wealth psychologist. Provide high-status, clinically insightful guidance. Be authoritative, calm, and concise. Use visual cues from the screen to provide more context to your answers.',
        },
        callbacks: {
          onopen: () => {
            setAiMode('listening');
            if (audioContextInRef.current && micStream) {
              const source = audioContextInRef.current.createMediaStreamSource(micStream);
              const scriptProcessor = audioContextInRef.current.createScriptProcessor(4096, 1, 1);
              scriptProcessor.onaudioprocess = (e) => {
                const inputData = e.inputBuffer.getChannelData(0);
                const pcmBlob = createPcmBlob(inputData);
                sessionPromise.then(session => {
                  session.sendRealtimeInput({ media: pcmBlob });
                });
              };
              source.connect(scriptProcessor);
              scriptProcessor.connect(audioContextInRef.current.destination);
            }

            if (screenStreamRef.current && canvasRef.current) {
              const video = document.createElement('video');
              video.srcObject = screenStreamRef.current;
              video.play().catch(console.error);
              const ctx = canvasRef.current.getContext('2d');
              frameIntervalRef.current = window.setInterval(() => {
                if (ctx && video.readyState === video.HAVE_ENOUGH_DATA && canvasRef.current) {
                  canvasRef.current.width = 1024;
                  canvasRef.current.height = 576;
                  ctx.drawImage(video, 0, 0, 1024, 576);
                  canvasRef.current.toBlob(async (blob) => {
                    if (blob) {
                      const base64 = await blobToBase64(blob);
                      sessionPromise.then(session => {
                        session.sendRealtimeInput({ media: { data: base64, mimeType: 'image/jpeg' } });
                      });
                    }
                  }, 'image/jpeg', 0.6);
                }
              }, 1500);
            }
          },
          onmessage: async (message: LiveServerMessage) => {
            // Handle Interruption
            if (message.serverContent?.interrupted) {
              sourcesRef.current.forEach(source => {
                try { source.stop(); } catch(e) {}
              });
              sourcesRef.current.clear();
              nextStartTimeRef.current = 0;
              setAiMode('listening');
              return;
            }

            // Handle Audio Output
            const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (base64Audio && audioContextOutRef.current) {
              const ctx = audioContextOutRef.current;
              if (ctx.state === 'suspended') await ctx.resume();
              
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
              
              try {
                const audioBuffer = await decodeAudioData(decode(base64Audio), ctx, 24000, 1);
                const source = ctx.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(ctx.destination);
                
                source.onended = () => {
                  sourcesRef.current.delete(source);
                  if (sourcesRef.current.size === 0) setAiMode('listening');
                };
                
                source.start(nextStartTimeRef.current);
                nextStartTimeRef.current += audioBuffer.duration;
                sourcesRef.current.add(source);
                setAiMode('speaking');
              } catch (err) {
                console.error("Audio playback error:", err);
              }
            }
          },
          onclose: () => stopAiSession(),
          onerror: (e) => {
            console.error("AI Session Error:", e);
            stopAiSession();
          }
        }
      });
    } catch (e) { 
      console.error("Start Session Error:", e);
      stopAiSession(); 
    }
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
              disabled={isAiActive}
              className="bg-brand-dark text-white px-9 py-3 rounded-sm text-[10px] font-bold uppercase tracking-[0.3em] hover:bg-brand-orange transition-all duration-300 shadow-lg disabled:opacity-50"
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
              <button 
                onClick={startAiSession} 
                disabled={isAiActive}
                className="bg-brand-yellow text-brand-dark px-12 py-5 text-[11px] font-bold uppercase tracking-[0.4em] hover:bg-white transition-all duration-500 shadow-xl disabled:opacity-50"
              >
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

      {/* DEV GUIDE OVERLAY */}
      {showDevGuide && (
        <div className="fixed inset-0 z-[200] bg-brand-dark/90 backdrop-blur-xl flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-3xl p-12 max-h-[90vh] overflow-y-auto">
             <h2 className="text-2xl font-bold uppercase tracking-widest text-brand-dark mb-8">Implementation Guide</h2>
             <p className="text-sm text-brand-dark/70 mb-8">Ensure your Vercel project has an Environment Variable named <code>API_KEY</code> set with your Gemini API key.</p>
             <button onClick={() => setShowDevGuide(false)} className="bg-brand-dark text-white px-8 py-4 text-[10px] font-bold uppercase tracking-widest">Close</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
