import { useState, useRef, useEffect, useCallback } from 'react';

interface Props {
  onSave: (name: string) => void;
  onCancel: () => void;
}

export function SaveToLibraryModal({ onSave, onCancel }: Props) {
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onCancel();
  }, [onCancel]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed) onSave(trimmed);
  };

  return (
    <>
      <div className="save-library-backdrop" onMouseDown={onCancel} />
      <div className="save-library-modal">
        <form onSubmit={handleSubmit}>
          <label className="form-label">
            Template name
            <input
              ref={inputRef}
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter a name..."
            />
          </label>
          <div className="save-library-modal__actions">
            <button type="button" className="btn save-library-modal__btn" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="btn save-library-modal__btn save-library-modal__btn--primary" disabled={!name.trim()}>
              Save
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
