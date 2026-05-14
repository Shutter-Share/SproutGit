type Option<T extends string = string> = {
  value: T;
  label: string;
  disabled?: boolean;
};

type Props<T extends string = string> = {
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
  placeholder?: string;
  disabled?: boolean;
  label?: string;
  id?: string;
};

export function Select<T extends string = string>({
  value,
  options,
  onChange,
  placeholder,
  disabled = false,
  label,
  id,
}: Props<T>) {
  const selectId = id ?? `sg-select-${Math.random().toString(36).slice(2)}`;
  return (
    <div className="flex flex-col gap-1 w-full">
      {label && <label htmlFor={selectId} className="text-[11px] font-semibold text-(--sg-text-dim) uppercase tracking-[0.04em]">{label}</label>}
      <select
        id={selectId}
        className="w-full px-[10px] py-[6px] bg-(--sg-input-bg) border border-(--sg-input-border) rounded-[6px] text-xs text-(--sg-text) outline-none focus:border-(--sg-input-focus) cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        value={value}
        onChange={e => onChange(e.target.value as T)}
        disabled={disabled}
      >
        {placeholder && (
          <option value="" disabled>{placeholder}</option>
        )}
        {options.map(opt => (
          <option key={opt.value} value={opt.value} disabled={opt.disabled}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}
