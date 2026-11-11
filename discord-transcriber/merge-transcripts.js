function mergeTranscripts(memoryTranscript, diskTranscript) {
  const memory = memoryTranscript?.trim() || '';
  const disk = diskTranscript?.trim() || '';

  if (!memory) return disk;
  if (!disk) return memory;
  if (memory === disk) return disk;

  const split = text => text.split(/\n\s*\n/).filter(Boolean);

  const memoryBlocks = split(memory);
  const diskBlocks = split(disk);

  const counts = new Map();

  for (const block of diskBlocks) {
    counts.set(block, (counts.get(block) || 0) + 1);
  }

  const extra = [];

  for (const block of memoryBlocks) {
    const count = counts.get(block) || 0;

    if (count > 0) {
      counts.set(block, count - 1);
    } else {
      extra.push(block);
    }
  }

  function timestamp(block) {
    const match = block.match(/^\[(\d+):(\d{2})\]/);

    if (!match) return Infinity;

    return Number(match[1]) * 60 + Number(match[2]);
  }

  // Стабильная сортировка: при одинаковом времени
  // сохраняем исходный порядок элементов.
  return [...diskBlocks, ...extra]
    .map((block, index) => ({
      block,
      index,
      time: timestamp(block)
    }))
    .sort((a, b) => a.time - b.time || a.index - b.index)
    .map(item => item.block)
    .join('\n\n');
}

module.exports = { mergeTranscripts };
