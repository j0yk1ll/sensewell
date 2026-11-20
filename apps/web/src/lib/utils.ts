import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatClipTime(milliseconds: number, showMilliseconds = false) {
  const seconds = Math.floor(milliseconds / 1000);
  const position = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  return showMilliseconds ? `${position}.${String(milliseconds % 1000).padStart(3, '0')}` : position;
}
