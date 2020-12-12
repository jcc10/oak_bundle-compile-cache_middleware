import { assert } from "https://deno.land/std@0.79.0/testing/asserts.ts";
import { createHash } from "https://deno.land/std/hash/mod.ts";
import * as fs from "https://deno.land/std@0.79.0/fs/mod.ts";

interface paths {
  source: string;
  sourceURI: string;
  bundle: string | false;
  transpile: string | false;
  compiled: string | false;
}

export interface BCC_Settings {
  tsSource: string;
  bundleFolder?: string;
  compiledFolder?: string;
  transpileFolder?: string;
  cacheFolder?: string;
  cacheRoot?: string;
  mapSources?: boolean;
}

export class BCC {
  private tsSource: string;
  private bundleFolder?: string;
  private compiledFolder?: string;
  private transpileFolder?: string;
  private cacheFolder?: string;
  private cacheRoot?: string;
  private cacheMap: Map<string, string> = new Map<string, string>();
  private mapSources: boolean;
  /**
     * Constructs a Bundle-Compile-Cache provider.
     * @param tsSource TypeScript code source folder.
     * @param bundleFolder Folder for caching bundled code.
     * @param compiledFolder Folder for caching compiled code.
     * @param cacheFolder Folder for caching remote code.
     * @param cacheRoot The root URL for cached code.
     * @param mapSources If we should attempt to re-write sources.
     */
  constructor(settings: BCC_Settings) {
    this.tsSource = settings.tsSource;
    this.bundleFolder = settings.bundleFolder;
    this.compiledFolder = settings.compiledFolder;
    this.transpileFolder = settings.transpileFolder;
    this.cacheFolder = settings.cacheFolder;
    this.cacheRoot = settings.cacheRoot;
    this.mapSources = settings.mapSources || false;
  }

  /**
     * Clear previously bundled code.
     */
  public async clearBundleCache() {
    if (!this.bundleFolder) {
      return;
    }
    await fs.emptyDir(`./${this.bundleFolder}/`);
  }
  /**
     * Clear previously compiled code.
     */
  public async clearCompileCache() {
    if (!this.compiledFolder) {
      return;
    }
    await fs.emptyDir(`./${this.compiledFolder}/`);
  }
  /**
     * Clear previously transpile code.
     */
  public async clearTranspileCache() {
    if (!this.transpileFolder) {
      return;
    }
    await fs.emptyDir(`./${this.transpileFolder}/`);
  }
  /**
     * Clear previously fetched external code.
     */
  public async clearExternalCache() {
    if (!this.cacheFolder) {
      return;
    }
    await fs.emptyDir(`./${this.cacheFolder}/`);
  }
  /**
     * Clear all previously cached code.
     */
  public async clearAllCache() {
    const clearing = [
      this.clearBundleCache(),
      this.clearCompileCache(),
      this.clearTranspileCache(),
      this.clearExternalCache(),
    ];
    await Promise.all(clearing);
  }

  /**
     * Adds a remote source for code.
     * @param handle short text for the source
     * @param source full source text
     */
  public addCacheSource(handle: string, source: string) {
    this.cacheMap.set(handle, source);
  }

  /**
     * Replaces (or doesn't depending on setting) uri's with local cache url.
     * @param code unmapped code
     */
  private mapExternalSources(code: string): string {
    let c2 = code;
    if (this.mapSources == true) {
      for (const entry of this.cacheMap.entries()) {
        const [handle, source] = entry;
        c2 = c2.replaceAll(source, `${this.cacheRoot}/${handle}/`);
      }
    }
    return c2;
  }

  /**
     * Generates paths for given script.
     * @param script script name for path generation
     */
  private generatedPaths(script: string): paths {
    return {
      source: `./${this.tsSource}/${script}`,
      sourceURI: `file://${Deno.cwd()}/${this.tsSource}/`,
      bundle: this.bundleFolder ? `./${this.bundleFolder}/${script}` : false,
      transpile: this.transpileFolder ? `./${this.transpileFolder}/${script}` : false,
      compiled: this.compiledFolder
        ? `./${this.compiledFolder}/${script}`
        : false,
    };
  }

  /**
     * Checks if given script exists in the source folder.
     * @param script script name for searching.
     */
  public async valid(script?: string) {
    if (!script) {
      return false;
    }
    return await fs.exists(this.generatedPaths(script).source);
  }

  /**
     * This generalizes a lot of code.
     * @param script script name.
     * @param cachePath path for cached code.
     * @param generator generator function.
     * @param functionName name for error generation.
     */
  private async cacheOrGen(
    script: string,
    cachePath: string | false,
    generator: (script: string) => Promise<void>,
    functionName: string,
  ): Promise<string> {
    let data;
    if (cachePath) {
      data = `throw new Error("${functionName} somehow failed.")`;
      try {
        data = await Deno.readTextFile(cachePath);
      } catch {
        await generator(script.replace(/.js$/, ""));
        try {
          data = await Deno.readTextFile(cachePath);
        } catch(e) {
          data =
            `throw new Error("${functionName} failed to find file '${script}'.")`;
        }
      }
    } else {
      data =
        `throw new Error("${functionName} is disabled in the BCC configuration.")`;
    }
    return data;
  }

  /**
     * Compiles a script and caches it.
     * @param script script name
     */
  public async compile(script: string) {
    const paths = this.generatedPaths(script);
    if (!paths.compiled || ! this.compiledFolder) {
      return;
    }
    const [diagnostics, emitMap] = await Deno.compile(
      paths.source,
      undefined,
      {
        sourceMap: false,
        inlineSourceMap: true,
      },
    );
    assert(
      diagnostics == null,
      `Compile Error: ${JSON.stringify(diagnostics)}`,
    );
    const cwd = paths.sourceURI;
    for (const resource in emitMap) {
      const dir = paths.compiled;
      const code = this.mapExternalSources(emitMap[resource]);
      await fs.ensureDir(this.compiledFolder);
      await Deno.writeTextFile(`${dir}`, code);
    }
  }

  /**
     * Tries to retrieve a cached version of the script, failing that it will compile.
     * @param script script name
     */
  public async cachedCompile(script: string) {
    const ref = async (script: string) => {
      return await this.compile(script);
    };
    return await this.cacheOrGen(
      script,
      this.generatedPaths(script).compiled,
      ref,
      "cachedCompile",
    );
  }

  /**
     * Bundles a script and caches it.
     * @param script script name
     */
  public async bundle(script: string) {
    const paths = this.generatedPaths(script);
    if (!paths.bundle || !this.bundleFolder) {
      return;
    }
    const [diagnostics, emit] = await Deno.bundle(
      paths.source,
      undefined,
      {
        sourceMap: false,
        inlineSourceMap: true,
      },
    );
    assert(
      diagnostics == null,
      `Compile Error: ${JSON.stringify(diagnostics)}`,
    );
    const dir = paths.bundle;
    const code = this.mapExternalSources(emit);
    await fs.ensureDir(this.bundleFolder);
    await Deno.writeTextFile(`${dir}.js`, code);
  }

  /**
     * Tries to retrieve a cached version of the script, failing that it will bundle.
     * @param script script name
     */
  public async cachedBundle(script: string) {
    const ref = async (script: string) => {
      return await this.bundle(script);
    };
    return await this.cacheOrGen(
      script,
      this.generatedPaths(script).bundle,
      ref,
      "cachedBundle",
    );
  }

  /**
     * Transpile a script and caches it.
     * @param script script name
     */
  public async transpile(script: string) {
    const paths = this.generatedPaths(script);
    if (!paths.transpile || !this.transpileFolder) {
      return;
    }
    const emit = await Deno.transpileOnly(
      {"main.ts": paths.source},
      {
        sourceMap: false,
        inlineSourceMap: true,
      },
    );
    const dir = paths.transpile;
    const rawCode = <string><unknown>emit.source;
    const code = this.mapExternalSources(rawCode);
    await fs.ensureDir(this.transpileFolder);
    await Deno.writeTextFile(`${dir}`, code);
  }

  /**
     * Tries to retrieve a cached version of the script, failing that it will transpile.
     * @param script script name
     */
  public async cachedTranspile(script: string) {
    const ref = async (script: string) => {
      return await this.transpile(script);
    };
    return await this.cacheOrGen(
      script,
      this.generatedPaths(script).transpile,
      ref,
      "cachedTranspile",
    );
  }

  private async updateCache(script: string, src: string, uri: string) {
    if(!this.cacheFolder){
      return;
    }
    const resp = await fetch(`${this.cacheMap.get(src)}${script}`);
    const code = this.mapExternalSources(await resp.text());
    await fs.ensureDir(`${this.cacheFolder}/${src}/`);
    const hash = createHash("md5");
    hash.update(script);
    await Deno.writeTextFile(`${this.cacheFolder}/${src}/${hash.toString()}`, code);
  }

  /**
     * Checks if the given handle is a valid src.
     * @param handle source handle
     */
  public validSource(handle: string) {
    return this.cacheMap.has(handle);
  }

  /**
     * Tries to retrieve a cached version of the script, failing that it will fetch it.
     * @param script script name
     * @param handle source handle
     */
  public async scriptCache(script: string, handle: string): Promise<string> {
    let data;
    if (this.cacheFolder) {
      const hash = createHash("md5");
      hash.update(script);
      const uri = `./${this.cacheFolder}/${handle}/${hash.toString()}`;
      data = `throw new Error("external cache somehow failed.")`;
      try {
        data = await Deno.readTextFile(uri);
      } catch {
        await this.updateCache(script, handle, uri);
        try {
          data = await Deno.readTextFile(uri);
        } catch {
          data =
            `throw new Error("external cache missing file '${script}' for source '${handle}'.")`;
        }
      }
    } else {
      data = `throw new Error("External cache disabled.")`;
    }
    return data;
  }
}
