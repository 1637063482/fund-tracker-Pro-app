// Hook: File upload management extracted from PortfolioChat.jsx
import { useState, useRef, useCallback } from 'react';

export function useFileUpload() {
  const [attachment, setAttachment] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [ocrEngine, setOcrEngine] = useState('gemini');
  const fileInputRef = useRef(null);

  const handleFileChange = useCallback((e) => {
    const file = e.target.files[0];
    if (file) {
      setAttachment(file);
      setPreviewUrl(URL.createObjectURL(file));
    }
  }, []);

  const removeAttachment = useCallback(() => {
    setAttachment(null);
    setPreviewUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  return {
    attachment, setAttachment,
    previewUrl, setPreviewUrl,
    ocrEngine, setOcrEngine,
    fileInputRef,
    handleFileChange,
    removeAttachment
  };
}
