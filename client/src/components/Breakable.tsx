import React from 'react';

/**
 * Text that may wrap only after a separator (slash, dot, dash, underscore),
 * so endpoints and ids never break in the middle of a word.
 */
export const Breakable: React.FC<{ text: string }> = ({ text }) => {
  const parts = text.split(/(?<=[/.\-_?&=:])/);
  return (
    <>
      {parts.map((part, i) => (
        <React.Fragment key={i}>
          {part}
          {i < parts.length - 1 && <wbr />}
        </React.Fragment>
      ))}
    </>
  );
};
