import { BadRequestError } from './errors';

export interface ParsedStandardId {
  source: 'bz' | 'gbw';
  sourceId: string;
}

export function createStandardId(source: 'bz' | 'gbw', sourceId: string): string {
  return `${source}:${sourceId}`;
}

export function parseStandardId(id: string): ParsedStandardId {
  const [source, sourceId] = id.split(':');

  if ((source !== 'bz' && source !== 'gbw') || !sourceId) {
    throw new BadRequestError(`Unsupported standard id: ${id}`);
  }

  return {
    source,
    sourceId,
  };
}
