import React, { useCallback, useState } from 'react';
import { registerSamplesFromDB, uploadSamplesToDB, userSamplesDBConfig } from '../../idbutils.mjs';

//choose a directory to locally import samples
export default function ImportSoundsButton({ onComplete }) {
  let fileUploadRef = React.createRef();
  const [isUploading, setIsUploading] = useState(false);
  const onChange = useCallback(async () => {
    if (!fileUploadRef.current.files?.length) {
      return;
    }
    setIsUploading(true);

    await uploadSamplesToDB(userSamplesDBConfig, fileUploadRef.current.files).then(() => {
      registerSamplesFromDB(userSamplesDBConfig, () => {
        onComplete();
        setIsUploading(false);
      });
    });
  });

  return (
    <div>
      <label
        className="flex items-center gap-2 px-3 py-1.5 w-fit hover:opacity-50 whitespace-nowrap cursor-pointer border"
        style={{
          fontSize: 'var(--fs-input)',
          backgroundColor: 'color-mix(in srgb, var(--foreground) 8%, transparent)',
          borderColor: 'color-mix(in srgb, var(--foreground) 20%, transparent)',
          borderRadius: '0',
        }}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
          className="w-4 h-4"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M7.5 7.5h-.75A2.25 2.25 0 0 0 4.5 9.75v7.5a2.25 2.25 0 0 0 2.25 2.25h7.5a2.25 2.25 0 0 0 2.25-2.25v-7.5a2.25 2.25 0 0 0-2.25-2.25h-.75m0-3-3-3m0 0-3 3m3-3v11.25m6-2.25h.75a2.25 2.25 0 0 1 2.25 2.25v7.5a2.25 2.25 0 0 1-2.25 2.25h-7.5a2.25 2.25 0 0 1-2.25-2.25v-.75"
          />
        </svg>

        <input
          disabled={isUploading}
          ref={fileUploadRef}
          id="audio_file"
          style={{ display: 'none' }}
          type="file"
          directory=""
          webkitdirectory=""
          multiple
          accept="audio/*, .wav, .mp3, .m4a, .flac, .aac, .ogg"
          onChange={() => {
            onChange();
          }}
        />
        {isUploading ? 'importing...' : 'import sounds folder'}
      </label>
    </div>
  );
}
