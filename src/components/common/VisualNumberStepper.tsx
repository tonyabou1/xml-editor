import { useEffect, useState } from "react";

type VisualNumberStepperProps = {
  ariaLabel: string;
  fallback?: number;
  max?: number;
  min?: number;
  onChange: (value: number) => void;
  step?: number;
  value: unknown;
};

function clampStepperNumberValue(value: number, min?: number, max?: number) {
  if (!Number.isFinite(value)) return 0;
  let nextValue = value;
  if (typeof min === "number") nextValue = Math.max(min, nextValue);
  if (typeof max === "number") nextValue = Math.min(max, nextValue);
  return nextValue;
}

function getStepperNumberInputValue(value: unknown, fallback = 0) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? String(numberValue) : String(fallback);
}

function getStepperPrecision(step: number) {
  const stepText = String(step);
  return stepText.includes(".") ? stepText.split(".")[1].length : 0;
}

export function VisualNumberStepper({
  ariaLabel,
  fallback = 0,
  max,
  min,
  onChange,
  step = 1,
  value,
}: VisualNumberStepperProps) {
  const externalValue = getStepperNumberInputValue(value, fallback);
  const [draftValue, setDraftValue] = useState(externalValue);
  const [editing, setEditing] = useState(false);
  const stepPrecision = getStepperPrecision(step);

  useEffect(() => {
    if (!editing) setDraftValue(externalValue);
  }, [editing, externalValue]);

  const commitValue = (nextValue: number) => {
    if (!Number.isFinite(nextValue)) return;
    const roundedValue = stepPrecision > 0 ? Number(nextValue.toFixed(stepPrecision)) : nextValue;
    const clampedValue = clampStepperNumberValue(roundedValue, min, max);
    setDraftValue(String(clampedValue));
    onChange(clampedValue);
  };
  const numericDraftValue = Number(draftValue);
  const numericFallbackValue = Number(externalValue);
  const stepBaseValue = Number.isFinite(numericDraftValue)
    ? numericDraftValue
    : Number.isFinite(numericFallbackValue)
    ? numericFallbackValue
    : fallback;

  return (
    <div className="visual-number-stepper">
      <input
        type="number"
        aria-label={ariaLabel}
        min={min}
        max={max}
        step={step}
        value={draftValue}
        onFocus={() => setEditing(true)}
        onBlur={() => {
          setEditing(false);
          if (draftValue.trim() === "") {
            setDraftValue(externalValue);
          }
        }}
        onChange={(event) => {
          const nextDraft = event.currentTarget.value;
          setDraftValue(nextDraft);
          if (nextDraft.trim() === "" || !Number.isFinite(event.currentTarget.valueAsNumber)) return;
          commitValue(event.currentTarget.valueAsNumber);
        }}
      />
      <div className="visual-number-stepper-buttons">
        <button
          type="button"
          className="increment"
          aria-label={`Increase ${ariaLabel}`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => commitValue(stepBaseValue + step)}
        />
        <button
          type="button"
          className="decrement"
          aria-label={`Decrease ${ariaLabel}`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => commitValue(stepBaseValue - step)}
        />
      </div>
    </div>
  );
}
