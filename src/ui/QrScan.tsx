// Lector de QR con la cámara, sin salir de la web: en la app instalada, la cámara del móvil abriría el enlace de la
// sala en el navegador, fuera de la app. Usa el lector nativo (BarcodeDetector) si existe y, si no (iPhone), jsQR.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

type Detector = { detect: (s: CanvasImageSource) => Promise<{ rawValue: string }[]> };

async function nativeDetector(): Promise<Detector | null> {
  const D = (window as unknown as { BarcodeDetector?: { new (o: { formats: string[] }): Detector; getSupportedFormats?: () => Promise<string[]> } }).BarcodeDetector;
  if (!D) return null;
  try {
    const f = (await D.getSupportedFormats?.()) ?? [];
    return f.includes('qr_code') ? new D({ formats: ['qr_code'] }) : null;
  } catch {
    return null;
  }
}

/** Código de sala de un QR: el enlace `…?sala=ABCD` o las 4 letras sueltas. */
export function roomCodeFromQr(text: string): string | null {
  const t = text.trim();
  try {
    const c = new URL(t).searchParams.get('sala');
    if (c && /^[A-Z]{4}$/i.test(c)) return c.toUpperCase();
  } catch { /* no es un enlace */ }
  return /^[A-Z]{4}$/i.test(t) ? t.toUpperCase() : null;
}

/** ¿Tiene sentido ofrecer la cámara? En móviles y tabletas (pantalla táctil) con cámara accesible. */
export const canScan = () => !!navigator.mediaDevices?.getUserMedia && matchMedia('(pointer: coarse)').matches;

export function QrScanner({ onCode, onClose }: { onCode: (code: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [st, setSt] = useState<'starting' | 'scanning' | 'denied' | 'unavailable' | 'invalid'>('starting');
  const cb = useRef(onCode);
  cb.current = onCode;

  useEffect(() => {
    let stream: MediaStream | null = null;
    let frame = 0;
    let stopped = false;
    let bad: number | undefined;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      } catch (e) {
        const n = (e as DOMException)?.name;
        return setSt(n === 'NotAllowedError' || n === 'SecurityError' ? 'denied' : 'unavailable');
      }
      const v = video.current;
      if (stopped || !v) return stream.getTracks().forEach((t) => t.stop());
      v.srcObject = stream;
      await v.play().catch(() => {});
      setSt('scanning');
      const nat = await nativeDetector();
      const jsQR = nat ? null : (await import('jsqr')).default;
      const cv = document.createElement('canvas');
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      const tick = async () => {
        if (stopped) return;
        if (v.readyState >= 2 && v.videoWidth > 0) {
          let text: string | null = null;
          if (nat) text = (await nat.detect(v).catch(() => []))[0]?.rawValue ?? null;
          else if (jsQR && ctx) {
            const k = Math.min(1, 640 / v.videoWidth);
            cv.width = Math.round(v.videoWidth * k);
            cv.height = Math.round(v.videoHeight * k);
            ctx.drawImage(v, 0, 0, cv.width, cv.height);
            const img = ctx.getImageData(0, 0, cv.width, cv.height);
            text = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' })?.data ?? null;
          }
          if (text) {
            const c = roomCodeFromQr(text);
            if (c) {
              stopped = true;
              stream?.getTracks().forEach((t) => t.stop());
              return cb.current(c);
            }
            setSt('invalid');
            clearTimeout(bad);
            bad = window.setTimeout(() => setSt('scanning'), 1500);
          }
        }
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    })();
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      clearTimeout(bad);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const msg = {
    starting: 'Abriendo la cámara…',
    scanning: 'Apunta al código QR de la mesa o de la sala.',
    invalid: 'Ese QR no es de una sala de Maldiciones.',
    denied: 'No hay permiso para usar la cámara. Actívalo en los ajustes o escribe el código.',
    unavailable: 'No se puede usar la cámara en este dispositivo. Escribe el código.',
  }[st];
  return createPortal(
    <div className="opts-modal" role="dialog" aria-label="Escanear QR" onClick={onClose}>
      <div className="opts-box qr-scan" onClick={(e) => e.stopPropagation()}>
        <h2>Escanear QR</h2>
        <div className="qr-view">
          <video ref={video} playsInline muted autoPlay />
          <span className="qr-frame" aria-hidden="true" />
        </div>
        <p className={`qr-msg ${st === 'scanning' || st === 'starting' ? '' : 'bad'}`} role="status">{msg}</p>
        <button type="button" className="play" onClick={onClose}>Cerrar</button>
      </div>
    </div>,
    document.body,
  );
}
