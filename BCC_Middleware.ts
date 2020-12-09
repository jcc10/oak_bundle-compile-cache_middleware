// deno-lint-ignore camelcase
import { BCC, BCC_Settings } from './BCC.ts';
import type { Context, Middleware } from 'https://deno.land/x/oak@v6.3.2/mod.ts';
export interface BCC_Middleware_Settings {
    BCC_Settings: BCC_Settings,
    BundleRegEx?: RegExp | null,
    CompileRegEx?: RegExp | null,
    CacheRegEx?: RegExp | null,
}

// deno-lint-ignore camelcase
export class BCC_Middleware {
    private BundleRegEx: RegExp | null = /\/bundled\/(.+)/;
    private CompileRegEx: RegExp | null = /\/compiled\/(.+)/;
    private CacheRegEx: RegExp | null = /\/cache\/(.+?)\/(.+)/;
    public readonly bcc: BCC;
    constructor(settings: BCC_Middleware_Settings) {
        this.bcc = new BCC(settings.BCC_Settings);
        if (settings.BundleRegEx != undefined) {
            this.BundleRegEx = settings.BundleRegEx
        }
        if (!settings.BCC_Settings.bundleFolder) {
            this.BundleRegEx = null;
        }
        if (settings.CompileRegEx != undefined) {
            this.CompileRegEx = settings.CompileRegEx
        }
        if (!settings.BCC_Settings.compiledFolder) {
            this.CompileRegEx = null;
        }
        if (settings.CacheRegEx != undefined) {
            this.CacheRegEx = settings.CacheRegEx
        }
        if (!settings.BCC_Settings.cacheFolder) {
            this.CacheRegEx = null;
        }
    }

    middleware(): Middleware {
        const bundledRE = this.BundleRegEx;
        const compiledRE = this.CompileRegEx;
        const cacheRE = this.CacheRegEx;
        const bcc = this.bcc;
        return async (context: Context, next: () => Promise<void>) => {
            if (bundledRE?.test(context.request.url.pathname)) {
                const [_, script] = <RegExpExecArray>bundledRE.exec(context.request.url.pathname);
                context.response.body = await bcc.cachedBundle(script);
                context.response.type = "text/javascript";
            } else if (compiledRE?.test(context.request.url.pathname)) {
                const [_, script] = <RegExpExecArray>compiledRE.exec(context.request.url.pathname);
                context.response.body = await bcc.cachedCompile(script);
                context.response.type = "text/javascript";
            } else if (cacheRE?.test(context.request.url.pathname)) {
                const [_, src, script] = <RegExpExecArray>cacheRE.exec(context.request.url.pathname);
                context.response.body = await bcc.scriptCache(script, src);
                context.response.type = "text/javascript";
            } else {
                await next();
            }
        }
    }
}