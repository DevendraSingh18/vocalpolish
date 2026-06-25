/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  Mic, 
  Square, 
  Upload, 
  Download, 
  Sparkles, 
  RotateCcw, 
  Play, 
  Pause, 
  Volume2, 
  Settings2,
  CheckCircle2,
  AlertCircle,
  FileAudio
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import WaveSurfer from 'wavesurfer.js';
import { polishAudio, audioBufferToWav, DEFAULT_OPTIONS, type AudioProcessingOptions } from './lib/audioProcessor';

// --- Components ---

interface WaveformProps {
  blob: Blob | null;
  id: string;
  color?: string;
}

const Waveform: React.FC<WaveformProps> = ({ blob, id, color = '#3b82f6' }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    if (!containerRef.current || !blob) return;

    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: color,
      progressColor: '#ffffff',
      cursorColor: '#ffffff',
      height: 80,
      barWidth: 2,
      barGap: 3,
      barRadius: 4,
      fillParent: true,
    });

    const url = URL.createObjectURL(blob);
    ws.load(url).catch(err => {
      if (err.name !== 'AbortError') {
        console.error('WaveSurfer load error:', err);
      }
    });
    wavesurferRef.current = ws;

    ws.on('play', () => setIsPlaying(true));
    ws.on('pause', () => setIsPlaying(false));
    ws.on('finish', () => setIsPlaying(false));

    return () => {
      ws.destroy();
      URL.revokeObjectURL(url);
    };
  }, [blob, color]);

  const togglePlay = () => {
    wavesurferRef.current?.playPause();
  };

  if (!blob) return null;

  return (
    <div className="relative group bg-zinc-900/50 rounded-xl p-4 border border-zinc-800 backdrop-blur-sm">
      <div ref={containerRef} className="w-full" />
      <button
        type="button"
        onClick={togglePlay}
        className="absolute left-6 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center transition-all opacity-0 group-hover:opacity-100 z-20 backdrop-blur-md border border-white/30 cursor-pointer shadow-lg"
      >
        {isPlaying ? <Pause className="w-4 h-4 fill-white text-white" /> : <Play className="w-4 h-4 fill-white text-white ml-0.5" />}
      </button>
    </div>
  );
};

export default function App() {
  const [rawBlob, setRawBlob] = useState<Blob | null>(null);
  const [processedBlob, setProcessedBlob] = useState<Blob | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [status, setStatus] = useState<'idle' | 'recording' | 'processing' | 'done' | 'error'>('idle');
  const [options, setOptions] = useState<AudioProcessingOptions>(DEFAULT_OPTIONS);
  const [recordingTime, setRecordingTime] = useState(0);
  const [errorMessage, setErrorMessage] = useState('');

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // --- Handlers ---

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const mimeType = mediaRecorder.mimeType || 'audio/webm';
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        setRawBlob(audioBlob);
        setProcessedBlob(null);
        setStatus('idle');
      };

      mediaRecorder.start();
      setIsRecording(true);
      setStatus('recording');
      setRecordingTime(0);
      timerRef.current = window.setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      console.error('Error accessing microphone:', err);
      setStatus('error');
      setErrorMessage('Microphone access denied or error occurred.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach((track) => track.stop());
      setIsRecording(false);
      if (timerRef.current) clearInterval(timerRef.current);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.type.startsWith('audio/')) {
        setRawBlob(file);
        setProcessedBlob(null);
        setStatus('idle');
      } else {
        setStatus('error');
        setErrorMessage('Invalid file type. Please upload an audio file.');
      }
    }
  };

  const processAudio = async () => {
    if (!rawBlob) return;
    setStatus('processing');
    try {
      const arrayBuffer = await rawBlob.arrayBuffer();
      const polishedBuffer = await polishAudio(arrayBuffer, options);
      const polishedWavBlob = audioBufferToWav(polishedBuffer);
      setProcessedBlob(polishedWavBlob);
      setStatus('done');
    } catch (err) {
      console.error('Processing error:', err);
      setStatus('error');
      setErrorMessage('Failed to process audio. Ensure the file is not corrupted.');
    }
  };

  const downloadProcessed = () => {
    if (!processedBlob) return;
    const url = URL.createObjectURL(processedBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `polished_audio_${Date.now()}.wav`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // --- Effects ---

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans selection:bg-blue-500/30">
      {/* Background Decor */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-900/10 blur-[120px] rounded-full" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-emerald-900/10 blur-[120px] rounded-full" />
      </div>

      <div className="relative max-w-4xl mx-auto px-6 py-12">
        {/* Header */}
        <header className="flex items-center justify-between mb-12">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center shadow-lg shadow-blue-600/20">
              <Sparkles className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">VocalPolish</h1>
              <p className="text-zinc-500 text-sm font-medium">Studio Enhancement Engine</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
             <div className="flex items-center gap-2 px-3 py-1.5 bg-zinc-900 rounded-full border border-zinc-800 text-xs font-mono text-zinc-400">
               <span className={`w-2 h-2 rounded-full ${status === 'recording' ? 'bg-red-500 animate-pulse' : 'bg-zinc-700'}`} />
               {status === 'recording' ? 'LIVE' : 'STANDBY'}
             </div>
          </div>
        </header>

        <main className="space-y-8">
          {/* Main Console */}
          <section className="bg-zinc-900/30 border border-zinc-800 rounded-3xl p-8 backdrop-blur-md shadow-2xl overflow-hidden relative">
            <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
              <Sparkles className="w-64 h-64 -mr-20 -mt-20" />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {/* Left Column: Capture */}
              <div className="space-y-6">
                <div>
                  <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                    <Volume2 className="w-4 h-4" /> Input Capture
                  </h3>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <button
                      onClick={isRecording ? stopRecording : startRecording}
                      className={`relative overflow-hidden h-32 rounded-2xl flex flex-col items-center justify-center gap-2 transition-all border-2 ${
                        isRecording 
                        ? 'bg-red-500/10 border-red-500 shadow-[0_0_20px_rgba(239,68,68,0.2)]' 
                        : 'bg-zinc-800/50 border-zinc-700 hover:border-zinc-500 hover:bg-zinc-800'
                      }`}
                    >
                      <AnimatePresence mode="wait">
                        {isRecording ? (
                          <motion.div
                            key="stop"
                            initial={{ scale: 0, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0, opacity: 0 }}
                          >
                            <Square className="w-8 h-8 text-red-500 fill-red-500" />
                          </motion.div>
                        ) : (
                          <motion.div
                            key="mic"
                            initial={{ scale: 0, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0, opacity: 0 }}
                          >
                            <Mic className="w-8 h-8 text-zinc-300" />
                          </motion.div>
                        )}
                      </AnimatePresence>
                      <span className={`text-xs font-bold uppercase tracking-widest ${isRecording ? 'text-red-400' : 'text-zinc-400'}`}>
                        {isRecording ? formatTime(recordingTime) : 'Record Audio'}
                      </span>
                    </button>

                    <label className="h-32 rounded-2xl bg-zinc-800/50 border-2 border-zinc-700 border-dashed hover:border-zinc-500 hover:bg-zinc-800 flex flex-col items-center justify-center gap-2 cursor-pointer transition-all">
                      <Upload className="w-8 h-8 text-zinc-300" />
                      <span className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Upload File</span>
                      <input type="file" className="hidden" accept="audio/*" onChange={handleFileUpload} />
                    </label>
                  </div>
                </div>

                {/* Processing Options */}
                <div className="space-y-4 bg-black/20 p-5 rounded-2xl border border-zinc-800/50">
                  <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-tighter flex items-center gap-2">
                    <Settings2 className="w-3 h-3" /> Processing Engine (V1.2)
                  </h3>
                  
                  <div className="space-y-5">
                    <div className="space-y-2">
                      <div className="flex justify-between text-[10px] font-mono text-zinc-500 uppercase tracking-widest">
                        <span>Noise Gate</span>
                        <span>{options.noiseGateThreshold}dB</span>
                      </div>
                      <input 
                        type="range" min="-100" max="0" step="1"
                        value={options.noiseGateThreshold}
                        onChange={(e) => setOptions({...options, noiseGateThreshold: Number(e.target.value)})}
                        className="w-full accent-blue-500 h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer" 
                      />
                    </div>
                    
                    <div className="space-y-2">
                      <div className="flex justify-between text-[10px] font-mono text-zinc-500 uppercase tracking-widest">
                        <span>Clarity Boost</span>
                        <span>+{options.clarityBoost}dB</span>
                      </div>
                      <input 
                        type="range" min="0" max="15" step="0.5"
                        value={options.clarityBoost}
                        onChange={(e) => setOptions({...options, clarityBoost: Number(e.target.value)})}
                        className="w-full accent-emerald-500 h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer" 
                      />
                    </div>

                    <div className="space-y-2">
                      <div className="flex justify-between text-[10px] font-mono text-zinc-500 uppercase tracking-widest">
                        <span>Bass Boost</span>
                        <span>+{options.bassBoost}dB</span>
                      </div>
                      <input 
                        type="range" min="0" max="15" step="0.5"
                        value={options.bassBoost}
                        onChange={(e) => setOptions({...options, bassBoost: Number(e.target.value)})}
                        className="w-full accent-amber-500 h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer" 
                      />
                    </div>

                    <div className="space-y-2">
                      <div className="flex justify-between text-[10px] font-mono text-zinc-500 uppercase tracking-widest">
                        <span>Compression</span>
                        <span>{options.compressionRatio}:1</span>
                      </div>
                      <input 
                        type="range" min="1" max="12" step="0.5"
                        value={options.compressionRatio}
                        onChange={(e) => setOptions({...options, compressionRatio: Number(e.target.value)})}
                        className="w-full accent-purple-500 h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer" 
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Column: Waveforms & Actions */}
              <div className="flex flex-col h-full">
                <div className="flex-grow space-y-4">
                   <div className="space-y-2">
                     <div className="flex items-center justify-between px-1">
                        <span className="text-[10px] font-bold text-zinc-500 tracking-widest uppercase">Input Raw</span>
                        {rawBlob && <span className="text-[10px] font-mono text-zinc-500 uppercase">{(rawBlob.size / (1024*1024)).toFixed(2)} MB</span>}
                     </div>
                     <div className="h-24 bg-black/40 rounded-2xl border border-zinc-800 flex items-center justify-center overflow-hidden relative">
                        {rawBlob ? (
                          <div className="w-full h-full p-2">
                            <Waveform id="raw-ws" blob={rawBlob} color="#52525b" />
                          </div>
                        ) : (
                          <p className="text-zinc-600 text-xs font-mono">NO INPUT DETECTED</p>
                        )}
                     </div>
                   </div>

                   <div className="space-y-2">
                     <div className="flex items-center justify-between px-1">
                        <span className="text-[10px] font-bold text-blue-400 tracking-widest uppercase">Studio Polished</span>
                        {processedBlob && <div className="flex items-center gap-1 text-[10px] font-mono text-emerald-500"><CheckCircle2 className="w-3 h-3" /> READY</div>}
                     </div>
                     <div className="h-24 bg-black/40 rounded-2xl border border-zinc-800 flex items-center justify-center overflow-hidden relative shadow-inner">
                        {processedBlob ? (
                          <div className="w-full h-full p-2">
                            <Waveform id="processed-ws" blob={processedBlob} color="#3b82f6" />
                          </div>
                        ) : (
                          <div className="text-center animate-pulse">
                             <p className="text-zinc-600 text-xs font-mono">{status === 'processing' ? 'POLISHING SIGNAL...' : 'AWAITING POLISH'}</p>
                          </div>
                        )}
                     </div>
                   </div>
                </div>

                <div className="mt-8 space-y-3">
                  <button
                    disabled={!rawBlob || status === 'processing'}
                    onClick={processAudio}
                    className={`w-full py-4 rounded-2xl flex items-center justify-center gap-3 font-bold uppercase tracking-widest transition-all ${
                      !rawBlob 
                      ? 'bg-zinc-800 text-zinc-600 cursor-not-allowed opacity-50' 
                      : 'bg-white text-black hover:bg-zinc-200 shadow-[0_10px_30px_rgba(255,255,255,0.1)] active:scale-95'
                    }`}
                  >
                    {status === 'processing' ? (
                      <div className="w-6 h-6 border-2 border-black border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <Sparkles className="w-5 h-5 fill-black" />
                    )}
                    {status === 'processing' ? 'Enhancing...' : 'Vocal Polish'}
                  </button>

                  <div className="grid grid-cols-2 gap-3">
                    <button
                      disabled={!processedBlob}
                      onClick={downloadProcessed}
                      className="py-3 rounded-xl bg-zinc-800/80 hover:bg-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-2 border border-zinc-700 text-xs font-bold uppercase tracking-widest"
                    >
                      <Download className="w-4 h-4" /> Export High-Res
                    </button>
                    <button
                      onClick={() => {
                        setRawBlob(null);
                        setProcessedBlob(null);
                        setStatus('idle');
                      }}
                      className="py-3 rounded-xl bg-zinc-800/80 hover:bg-zinc-700 flex items-center justify-center gap-2 border border-zinc-700 text-xs font-bold uppercase tracking-widest"
                    >
                      <RotateCcw className="w-4 h-4" /> Reset
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Status Bar */}
          <div className="flex items-center justify-between text-[11px] font-mono text-zinc-600 px-4">
             <div className="flex items-center gap-4">
                <span>BUFFER: 48KHZ / 24-BIT</span>
                <span>ENGINE: WEBAUDIO_OFFLINE_V2</span>
             </div>
             {status === 'error' && (
               <div className="flex items-center gap-2 text-red-500 animate-pulse">
                  <AlertCircle className="w-3 h-3" /> {errorMessage}
               </div>
             )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4">
            <FeatureCard 
              icon={<Sparkles className="w-5 h-5 text-blue-400" />}
              title="Presence Boost"
              description="Intelligent EQ that targets the 3-5kHz range to bring vocals forward."
            />
            <FeatureCard 
              icon={<MicrochipIcon className="w-5 h-5 text-emerald-400" />}
              title="Dynamics Control"
              description="Professional compression curves designed to level voices like a radio broadcast."
            />
            <FeatureCard 
              icon={<AudioLinesIcon className="w-5 h-5 text-purple-400" />}
              title="Noise Shield"
              description="Adaptive noise gating to keep silent parts silent and reduce floor hum."
            />
          </div>
        </main>
      </div>
    </div>
  );
}

function FeatureCard({ icon, title, description }: { icon: React.ReactNode, title: string, description: string }) {
  return (
    <div className="p-6 rounded-2xl bg-zinc-900/50 border border-zinc-800/50 flex flex-col gap-3">
       {icon}
       <h4 className="font-bold text-sm">{title}</h4>
       <p className="text-xs text-zinc-500 leading-relaxed">{description}</p>
    </div>
  );
}

// Extra Icons
function MicrochipIcon(props: any) {
  return (
    <svg {...props} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <rect x="9" y="9" width="6" height="6" />
      <path d="M15 2v2M9 2v2M2 15h2M2 9h2M20 15h2M20 9h2M15 20v2M9 20v2" />
    </svg>
  );
}

function AudioLinesIcon(props: any) {
  return (
    <svg {...props} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 10v3M6 6v11M10 3v18M14 8v7M18 5v13M22 10v3" />
    </svg>
  )
}

