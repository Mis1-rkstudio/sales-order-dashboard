// components/FileThumbnail.tsx
'use client';

import React, { JSX, useEffect, useMemo, useState } from 'react';
import Image from 'next/image';

type Props = {
  url?: string | URL | null;
  size?: number; // px, default 48
  className?: string;
  alt?: string;
  link?: boolean; // whether to wrap in <a> (default true)
};

/** small inline SVG placeholder as data URL (light gray) */
const PLACEHOLDER_SVG =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='48' height='48' viewBox='0 0 48 48'><rect width='100%' height='100%' fill='%23f3f4f6' /><g fill='%239ca3af'><circle cx='16' cy='18' r='6'/><rect x='28' y='12' width='8' height='8' rx='1'/></g></svg>`
  );

/** Try to extract Google Drive file id from common share URL forms */
function extractDriveId(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();

    if (host.endsWith('drive.google.com')) {
      const m = u.pathname.match(/\/file\/d\/([^/]+)/);
      if (m && m[1]) return m[1];
      const idParam = u.searchParams.get('id');
      if (idParam) return idParam;
      const m2 = u.pathname.match(/\/uc\/d\/([^/]+)/);
      if (m2 && m2[1]) return m2[1];
    }

    if (u.searchParams.has('id')) return u.searchParams.get('id');
  } catch {
    return null;
  }
  return null;
}

/** Build candidate image URLs for Google Drive id */
function driveCandidates(id: string): string[] {
  return [
    `https://drive.google.com/uc?export=view&id=${id}`,
    `https://drive.google.com/uc?export=download&id=${id}`,
    `https://drive.google.com/thumbnail?id=${id}`,
  ];
}

/** Format value to safe trimmed string or empty */
function safeTrim(value?: string | null): string {
  if (!value) return '';
  return String(value).trim();
}

/**
 * FileThumbnail (Next Image)
 * - Attempts raw URL first, then Google-Drive normalized URLs (if applicable).
 * - Uses next/image with `unoptimized` to avoid build-time domain config.
 * - Shows placeholder when no image is available or all attempts fail.
 * - When `link` is true (default) it renders an <a>; otherwise it renders only the image wrapped in a span.
 */
export default function FileThumbnail({
  url,
  size = 48,
  className = '',
  alt = 'file',
  link = true,
}: Props): JSX.Element | null {
  const raw = useMemo(() => {
    if (typeof url === 'string' || url == null) {
      return safeTrim(url);
    }
    if (url instanceof URL) {
      return safeTrim(url.toString());
    }
    return '';
  }, [url]);

  const initialCandidates = useMemo(() => {
    const list: string[] = [raw];
    const driveId = raw ? extractDriveId(raw) : null;
    if (driveId) list.push(...driveCandidates(driveId));
    return list;
  }, [raw]);

  const [index, setIndex] = useState<number>(0);

  useEffect(() => {
    setIndex(0);
  }, [raw]);

  // early exits (hooks already executed)
  if (!raw) return null;
  if (!raw.startsWith('http://') && !raw.startsWith('https://')) return null;

  function tryNextSource(): void {
    const next = index + 1;
    if (next < initialCandidates.length) {
      setIndex(next);
    } else {
      // go beyond list so placeholder is used
      setIndex(initialCandidates.length);
    }
  }

  const src = index < initialCandidates.length ? initialCandidates[index] : PLACEHOLDER_SVG;
  const href = src && src.startsWith('http') ? src : raw;
  const imgSize = Math.max(24, Math.min(96, Math.floor(size)));

  // typed handler for Next/Image onError
  const handleError = (): void => {
    tryNextSource();
  };

  // the image element (no anchor)
  const imgElement = (
    <Image
      src={src}
      width={imgSize}
      height={imgSize}
      alt={alt}
      unoptimized
      style={{
        width: imgSize,
        height: imgSize,
        objectFit: 'cover',
        borderRadius: 6,
        display: 'block',
      }}
      onError={handleError}
    />
  );

  if (link) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={`inline-block ${className}`} aria-label="Open file">
        {imgElement}
      </a>
    );
  }

  // no link: return just the image wrapped for layout/aria
  return <span className={`inline-block ${className}`} aria-hidden={false}>{imgElement}</span>;
}
