// Local audio files never leave the browser: Solo keeps the File objects in
// memory, creates object URLs only while a track is playing, and saves takes to
// the device. Nothing is uploaded.

import type { FreeTrack } from './playback';

const AUDIO_EXTENSIONS = /\.(mp3|m4a|aac|flac|wav|ogg|oga|opus|webm|mp4)$/i;

export function isAudioFile(file: File): boolean {
  if (file.type.startsWith('audio/')) return true;
  return AUDIO_EXTENSIONS.test(file.name);
}

/**
 * Turn filenames into a usable title/artist pair. "Artist - Title.mp3" is the
 * common download shape; everything else is treated as a title.
 */
export function localTrackFromFile(file: File, index: number): FreeTrack {
  const base = file.name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim();
  const dash = base.match(/^(.{2,80}?)\s+[-–—]\s+(.{1,120})$/);
  const artist = dash?.[1]?.trim() || 'Local file';
  const title = dash?.[2]?.trim() || base || `Track ${index + 1}`;
  return {
    id: `local-${index}-${file.name}-${file.size}`,
    source: 'local',
    name: title,
    artist,
    durationMs: 0,
    file,
  };
}

export function localTracksFromFiles(files: Iterable<File>): FreeTrack[] {
  return Array.from(files)
    .filter(isAudioFile)
    .map((file, index) => localTrackFromFile(file, index));
}
