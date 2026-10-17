import React, { useRef, useEffect, useState } from 'react';
import { BarcodeScanner } from '@/lib/scanner';
import { Camera, CameraOff, RefreshCw, Upload, Scan, Keyboard } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useDevices } from '@/contexts/DeviceContext';
import { LocalizedContent } from '@/contexts/LanguageContext';

interface ScannerProps {
  onResult: (barcode: string) => void;
  onError?: (error: Error) => void;
  initialMirrorMode?: boolean;
  onShutdownComplete?: (info: {
    streamsStopped: number;
    tracksStopped: number;
    trackStates: Array<'ended' | 'live' | 'unknown'>;
    memory?: { before?: number; after?: number; delta?: number };
  }) => void;
}

const Scanner: React.FC<ScannerProps> = ({ onResult, onError, initialMirrorMode = false, onShutdownComplete }) => {
  const { deviceMode } = useDevices();
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<BarcodeScanner | null>(null);
  const [isActive, setIsActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mirrorMode, setMirrorMode] = useState(initialMirrorMode);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const memoryBeforeRef = useRef<number | undefined>(undefined);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (deviceMode === 'pc') return; // Don't initialize camera on PC mode

    scannerRef.current = new BarcodeScanner();
    
    // Auto-start scanning when component mounts
    const timer = setTimeout(() => {
      startScanning();
    }, 500);
    
    return () => {
      clearTimeout(timer);
      if (scannerRef.current) {
        scannerRef.current.stopScanning();
      }
      // Clean up video streams on unmount
      if (videoRef.current && videoRef.current.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach(track => track.stop());
        videoRef.current.srcObject = null;
      }
    };
  }, [deviceMode]);

  if (deviceMode === 'pc') {
    return (
      <LocalizedContent>
      <div className="bg-gray-50 border-2 border-dashed border-gray-200 rounded-2xl p-8 flex flex-col items-center justify-center text-center space-y-4">
        <div className="w-16 h-16 bg-amber-50 rounded-full flex items-center justify-center">
          <Keyboard className="w-8 h-8 text-[#BF953F]" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-gray-900">External Scanner Mode</h3>
          <p className="text-sm text-gray-500 max-w-[200px] mx-auto">
            Camera is disabled. Please use your connected USB or Bluetooth scanner.
          </p>
        </div>
      </div>
      </LocalizedContent>
    );
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!scannerRef.current) {
        scannerRef.current = new BarcodeScanner();
    }
    
    try {
      setError(null);
      const result = await scannerRef.current.decodeFromImageFile(file);
      onResult(result);
    } catch (err) {
      console.error(err);
      setError('Could not read barcode from image. Please try again.');
      onError?.(err as Error);
    } finally {
        // Reset input so same file can be selected again if needed
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    }
  };

  const startScanning = async () => {
    if (!videoRef.current || !scannerRef.current) return;

    try {
      setError(null);
      try {
        const mem = (performance as any)?.memory?.usedJSHeapSize;
        if (typeof mem === 'number') memoryBeforeRef.current = mem;
      } catch {}
      await scannerRef.current.startScanning(
        videoRef.current,
        (barcode) => {
          onResult(barcode);
          // Briefly pause after successful scan to prevent multiple scans of same item
          setIsActive(false);
          setTimeout(() => {
            if (scannerRef.current && !scannerRef.current.isScanning()) {
              startScanning();
            }
          }, 2000);
        },
        (err) => {
          // Check if this is a reconnection attempt
          if (err.message.includes('reconnection')) {
            setIsReconnecting(true);
            setError('Reconnecting camera...');
          } else if (err.message.includes('reconnection failed')) {
            setIsReconnecting(false);
            setError('Camera disconnected. Please restart scanner.');
            setIsActive(false);
          } else {
            setIsReconnecting(false);
            setError(err.message || 'Scanner error occurred');
          }
          onError?.(err);
        },
        mirrorMode
      );
      setIsActive(true);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Camera access denied or not available';
      setError(errorMessage);
      onError?.(err as Error);
    }
  };

  const handleManualScan = async () => {
    if (!videoRef.current || !scannerRef.current || !isActive) return;
    
    try {
      // Manual decode attempt from current video frame
      // ZXing's decodeFromVideoElement can be called even if the loop is running
      const result = await scannerRef.current.decodeFromVideoElement(videoRef.current);
      if (result) {
        onResult(result.getText());
      }
    } catch (err) {
      toast({
        title: "Scan Failed",
        description: "Could not identify barcode in current frame. Ensure it's centered and clear.",
        variant: "destructive"
      });
    }
  };

  const stopScanning = () => {
    try {
      const states: Array<'ended' | 'live' | 'unknown'> = [];
      let streamsStopped = 0;
      let tracksStopped = 0;
      scannerRef.current?.stopScanning();
      const video = videoRef.current;
      if (video && video.srcObject) {
        const stream = video.srcObject as MediaStream;
        const tracks = stream.getTracks();
        tracks.forEach(t => {
          try {
            t.stop();
            tracksStopped++;
            const rs = (t as any).readyState;
            states.push(rs === 'ended' ? 'ended' : rs === 'live' ? 'live' : 'unknown');
          } catch {}
        });
        try {
          stream.getTracks().forEach(() => {});
          streamsStopped++;
        } catch {}
        video.srcObject = null;
      }
      setIsActive(false);
      setIsReconnecting(false);
      setError(null);
      let memAfter: number | undefined;
      let memDelta: number | undefined;
      try {
        const mem = (performance as any)?.memory?.usedJSHeapSize;
        if (typeof mem === 'number') memAfter = mem;
        if (typeof memoryBeforeRef.current === 'number' && typeof memAfter === 'number') {
          memDelta = memAfter - memoryBeforeRef.current;
        }
      } catch {}
      onShutdownComplete?.({ streamsStopped, tracksStopped, trackStates: states, memory: { before: memoryBeforeRef.current, after: memAfter, delta: memDelta } });
      console.info('Scanner stopped', { streamsStopped, tracksStopped, trackStates: states, memoryBefore: memoryBeforeRef.current, memoryAfter: memAfter, memoryDelta: memDelta });
    } catch (e) {
      setError('Failed to stop camera');
      onError?.(e as Error);
      console.error('Camera shutdown failed', e);
    }
  };

  return (
    <LocalizedContent>
    <div className="relative">
      <input 
        type="file" 
        accept="image/*" 
        capture="environment" 
        className="hidden" 
        ref={fileInputRef}
        onChange={handleFileUpload}
      />
      <div className="relative bg-gray-900 rounded-xl overflow-hidden h-48">
        <video
          ref={videoRef}
          className={`w-full h-full object-cover ${mirrorMode ? 'scale-x-[-1]' : ''}`}
          autoPlay
          playsInline
          muted
        />
        
        {/* Scanner Overlay */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-48 h-32 border-2 border-primary-400 rounded-lg relative">
            {/* Corner decorations */}
            <div className="absolute top-0 left-0 w-6 h-6 border-l-4 border-t-4 border-primary-400 rounded-tl-lg"></div>
            <div className="absolute top-0 right-0 w-6 h-6 border-r-4 border-t-4 border-primary-400 rounded-tr-lg"></div>
            <div className="absolute bottom-0 left-0 w-6 h-6 border-l-4 border-b-4 border-primary-400 rounded-bl-lg"></div>
            <div className="absolute bottom-0 right-0 w-6 h-6 border-r-4 border-b-4 border-primary-400 rounded-br-lg"></div>
            
            {/* Scanning line */}
            {isActive && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-full h-1 bg-red-500 animate-pulse"></div>
              </div>
            )}
          </div>
        </div>

        {/* Status indicator */}
        <div className="absolute bottom-2 left-2 bg-black bg-opacity-50 text-white text-xs px-2 py-1 rounded flex items-center">
          {isReconnecting ? (
            <>
              <RefreshCw className="w-3 h-3 mr-1 animate-spin" />
              Reconnecting...
            </>
          ) : (
            <>
              <Camera className="w-3 h-3 mr-1" />
              {isActive ? 'Auto-scan enabled' : 'Camera inactive'}
            </>
          )}
        </div>

        {/* Error message */}
        {error && (
          <div className="absolute top-2 left-2 right-2 bg-red-500 text-white text-sm px-3 py-2 rounded">
            {error}
          </div>
        )}
      </div>

      {/* Control buttons */}
      <div className="flex justify-center mt-4 space-x-2 flex-wrap gap-y-2">
        <button
          onClick={handleManualScan}
          disabled={!isActive}
          className={`${!isActive ? 'bg-gray-400' : 'bg-pink-600'} text-white px-4 py-2 rounded-lg flex items-center touch-feedback shadow-md hover:bg-pink-700 transition-colors`}
        >
          <Scan className="w-5 h-5 mr-2" />
          Scan Now
        </button>

        <button
            onClick={() => fileInputRef.current?.click()}
            className="bg-blue-600 text-white px-3 py-2 rounded-lg flex items-center touch-feedback shadow-md hover:bg-blue-700 transition-colors"
        >
            <Upload className="w-4 h-4 mr-2" />
            Upload
        </button>

        <button
          onClick={() => {
            setMirrorMode(!mirrorMode);
            if (isActive) {
              stopScanning();
              setTimeout(() => startScanning(), 300);
            }
          }}
          className="bg-gray-700 text-white px-3 py-2 rounded-lg flex items-center touch-feedback shadow-md hover:bg-gray-800 transition-colors"
          title="Toggle mirror mode"
        >
          <RefreshCw className="w-4 h-4 mr-1" />
          {mirrorMode ? 'Front' : 'Back'}
        </button>
        
        {/* Retry button when there's an error */}
        {error && (
          <button
            onClick={() => {
              stopScanning();
              setTimeout(() => startScanning(), 500);
            }}
            className="bg-yellow-500 text-white px-6 py-2 rounded-lg flex items-center touch-feedback shadow-md hover:bg-yellow-600 transition-colors"
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Retry
          </button>
        )}
      </div>
      <p className="text-center text-[10px] text-gray-500 mt-2">
        Tip: Center the barcode in the box and hold steady. Use "Scan Now" if auto-scan is slow.
      </p>
    </div>
    </LocalizedContent>
  );
};

export default Scanner;
