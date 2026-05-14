import {
  useState,
  useRef,
  useEffect,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { ChevronDown } from 'lucide-react';

export type AutocompleteOption<T = string> = {
  value: T;
  label: string;
  description?: string;
};

type Props<T> = {
  options: AutocompleteOption<T>[];
  value?: T;
  onChange: (value: T) => void;
  placeholder?: string;
  /** Custom render for each option row. */
  renderOption?: (opt: AutocompleteOption<T>, active: boolean) => ReactNode;
  className?: string;
  disabled?: boolean;
  id?: string;
};

/**
 * Keyboard-navigable autocomplete/combobox. Matches old Svelte Autocomplete
 * behaviour: type to filter, arrow keys to navigate, Enter/click to select.
 */
export function Autocomplete<T = string>({
  options,
  value,
  onChange,
  placeholder = 'Select…',
  renderOption,
  className,
  disabled,
  id,
}: Props<T>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const filtered = options.filter(o =>
    !query.trim() || o.label.toLowerCase().includes(query.toLowerCase())
  );

  const selectedLabel = options.find(o => o.value === value)?.label ?? '';

  // Close when clicking outside.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Scroll active item into view.
  useEffect(() => {
    const el = listRef.current?.children[activeIdx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  function select(opt: AutocompleteOption<T>) {
    onChange(opt.value);
    setOpen(false);
    setQuery('');
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx(i => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const opt = filtered[activeIdx];
      if (opt) select(opt);
    } else if (e.key === 'Escape') {
      setOpen(false);
      setQuery('');
    }
  }

  function handleOpen() {
    if (disabled) return;
    setOpen(true);
    setActiveIdx(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  const inputCls = 'w-full px-[10px] py-[6px] bg-(--sg-input-bg) border border-(--sg-input-border) rounded-[6px] text-xs text-(--sg-text) outline-none focus:border-(--sg-input-focus)';
  const triggerCls = 'w-full flex items-center justify-between gap-2 px-[10px] py-[6px] bg-(--sg-input-bg) border border-(--sg-input-border) rounded-[6px] text-xs text-(--sg-text) cursor-pointer hover:border-(--sg-input-focus) disabled:opacity-50 disabled:cursor-not-allowed';

  return (
    <div ref={containerRef} className={['relative w-full', className].filter(Boolean).join(' ')}>
      {open ? (
        <input
          ref={inputRef}
          id={id}
          className={inputCls}
          value={query}
          onChange={e => { setQuery(e.target.value); setActiveIdx(0); }}
          onKeyDown={handleKeyDown}
          placeholder={selectedLabel || placeholder}
          aria-autocomplete="list"
          aria-expanded
          aria-controls="sg-autocomplete-list"
          role="combobox"
        />
      ) : (
        <button
          id={id}
          className={triggerCls}
          onClick={handleOpen}
          disabled={disabled}
          type="button"
        >
          <span className="truncate">{selectedLabel || <span className="text-(--sg-text-faint)">{placeholder}</span>}</span>
          <ChevronDown size={12} className="shrink-0 text-(--sg-text-faint)" />
        </button>
      )}

      {open && (
        <ul
          ref={listRef}
          id="sg-autocomplete-list"
          className="absolute top-full left-0 right-0 mt-1 bg-(--sg-surface) border border-(--sg-border) rounded-[6px] shadow-[0_4px_16px_rgba(0,0,0,0.12)] max-h-[200px] overflow-y-auto z-100 p-0 m-0 list-none"
          role="listbox"
        >
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-xs text-(--sg-text-faint)" role="option" aria-disabled>No results</li>
          ) : (
            filtered.map((opt, i) => (
              <li
                key={String(opt.value)}
                className={`flex items-center justify-between px-3 py-1.5 text-xs cursor-pointer transition-colors ${i === activeIdx ? 'bg-(--sg-surface-raised)' : 'hover:bg-(--sg-surface-raised)'}`}
                role="option"
                aria-selected={opt.value === value}
                onMouseDown={e => { e.preventDefault(); select(opt); }}
                onMouseEnter={() => setActiveIdx(i)}
              >
                {renderOption ? renderOption(opt, i === activeIdx) : (
                  <span>{opt.label}</span>
                )}
                {opt.description && <span className="text-[10px] text-(--sg-text-faint) ml-auto shrink-0 pl-2">{opt.description}</span>}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
