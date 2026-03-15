import { TFile, Vault } from "obsidian";

export interface MindDockFrontmatter {
  synced: boolean;
  noteId?: string;
  contentHash: string;
  proofUrl: string;
  lastDock: string;
  icTimestamp: string;
}

/**
 * Get MindDock metadata from file frontmatter
 */
export async function getMindDockFrontmatter(
  vault: Vault,
  file: TFile
): Promise<MindDockFrontmatter | null> {
  try {
    const content = await vault.read(file);
    const frontmatter = parseFrontmatter(content);
    
    if (frontmatter?.minddock) {
      return frontmatter.minddock as MindDockFrontmatter;
    }
    
    return null;
  } catch (error) {
    console.error("Error reading frontmatter:", error);
    return null;
  }
}

/**
 * Update MindDock metadata in file frontmatter
 */
export async function updateFrontmatter(
  vault: Vault,
  file: TFile,
  minddockData: Partial<MindDockFrontmatter>
): Promise<void> {
  const content = await vault.read(file);
  const { frontmatter, body } = splitContent(content);
  
  // Merge with existing minddock data
  const existingMinddock = frontmatter?.minddock || {};
  const newMinddock = { ...existingMinddock, ...minddockData };
  
  // Create new frontmatter
  const newFrontmatter = {
    ...frontmatter,
    minddock: newMinddock,
  };
  
  // Rebuild content
  const newContent = buildContent(newFrontmatter, body);
  
  await vault.modify(file, newContent);
}

/**
 * Parse YAML frontmatter from content
 */
function parseFrontmatter(content: string): Record<string, any> | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  
  try {
    return parseYaml(match[1]);
  } catch {
    return null;
  }
}

/**
 * Split content into frontmatter and body
 */
function splitContent(content: string): { frontmatter: Record<string, any> | null; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  
  if (match) {
    return {
      frontmatter: parseYaml(match[1]),
      body: match[2],
    };
  }
  
  return {
    frontmatter: null,
    body: content,
  };
}

/**
 * Build content from frontmatter and body
 */
function buildContent(frontmatter: Record<string, any> | null, body: string): string {
  if (!frontmatter || Object.keys(frontmatter).length === 0) {
    return body;
  }
  
  const yaml = stringifyYaml(frontmatter);
  return `---\n${yaml}---\n${body}`;
}

/**
 * Simple YAML parser (handles basic cases)
 */
function parseYaml(yaml: string): Record<string, any> {
  const result: Record<string, any> = {};
  const lines = yaml.split("\n");
  let currentKey = "";
  let currentIndent = 0;
  let nestedObject: Record<string, any> | null = null;
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    
    const indent = line.search(/\S/);
    const match = trimmed.match(/^([^:]+):\s*(.*)$/);
    
    if (match) {
      const [, key, value] = match;
      
      if (indent === 0) {
        // Top-level key
        if (value) {
          result[key] = parseValue(value);
        } else {
          // Start of nested object
          currentKey = key;
          currentIndent = indent;
          nestedObject = {};
          result[key] = nestedObject;
        }
      } else if (nestedObject && indent > currentIndent) {
        // Nested key
        nestedObject[key] = parseValue(value);
      }
    }
  }
  
  return result;
}

/**
 * Parse a YAML value
 */
function parseValue(value: string): any {
  if (!value) return null;
  
  // Boolean
  if (value === "true") return true;
  if (value === "false") return false;
  
  // Number
  if (/^\d+$/.test(value)) return parseInt(value, 10);
  if (/^\d+\.\d+$/.test(value)) return parseFloat(value);
  
  // String (remove quotes if present)
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  
  return value;
}

/**
 * Simple YAML stringifier
 */
function stringifyYaml(obj: Record<string, any>, indent: number = 0): string {
  const spaces = "  ".repeat(indent);
  let result = "";
  
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) continue;
    
    if (typeof value === "object" && !Array.isArray(value)) {
      result += `${spaces}${key}:\n`;
      result += stringifyYaml(value, indent + 1);
    } else if (Array.isArray(value)) {
      result += `${spaces}${key}:\n`;
      for (const item of value) {
        result += `${spaces}  - ${stringifyValue(item)}\n`;
      }
    } else {
      result += `${spaces}${key}: ${stringifyValue(value)}\n`;
    }
  }
  
  return result;
}

/**
 * Stringify a value for YAML
 */
function stringifyValue(value: any): string {
  if (typeof value === "string") {
    // Quote if contains special chars
    if (value.includes(":") || value.includes("#") || value.includes("\n")) {
      return `"${value.replace(/"/g, '\\"')}"`;
    }
    return value;
  }
  return String(value);
}
