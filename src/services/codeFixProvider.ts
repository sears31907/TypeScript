/* @internal */
namespace ts {
    export interface CodeFixRegistration {
        errorCodes: number[];
        getCodeActions(context: CodeFixContext): CodeFix[] | undefined;
        groupIds: string[];
        fixAllInGroup(context: CodeFixAllContext): CodeActionAll;
    }

    //name
    export interface CodeFixContextBase extends textChanges.TextChangesContext {
        sourceFile: SourceFile;
        program: Program;
        host: LanguageServiceHost;
        cancellationToken: CancellationToken;
    }

    export interface CodeFixAllContext extends CodeFixContextBase {
        groupId: {};
    }

    export interface CodeFixContext extends CodeFixContextBase {
        errorCode: number;
        span: TextSpan;
    }

    export namespace codefix {
        const codeFixes: CodeFixRegistration[][] = [];
        const groups = createMap<CodeFixRegistration>();

        export function registerCodeFix(codeFix: CodeFixRegistration) {
            for (const error of codeFix.errorCodes) {
                let fixes = codeFixes[error];
                if (!fixes) {
                    fixes = [];
                    codeFixes[error] = fixes;
                }
                fixes.push(codeFix);
            }
            if (codeFix.groupIds) {
                for (const gid of codeFix.groupIds) {
                    Debug.assert(!groups.has(gid));
                    groups.set(gid, codeFix);
                }
            }
        }

        export function getSupportedErrorCodes() {
            return Object.keys(codeFixes);
        }

        export function getFixes(context: CodeFixContext): CodeFix[] {
            const fixes = codeFixes[context.errorCode];
            const allActions: CodeFix[] = [];

            forEach(fixes, f => {
                const actions = f.getCodeActions(context);
                if (actions && actions.length > 0) {
                    for (const action of actions) {
                        if (action === undefined) {
                            context.host.log(`Action for error code ${context.errorCode} added an invalid action entry; please log a bug`);
                        }
                        else {
                            allActions.push(action);
                        }
                    }
                }
            });

            return allActions;
        }

        export function getAllFixes(context: CodeFixAllContext): CodeActionAll {
            // Currently groupId is always a string.
            return groups.get(cast(context.groupId, isString)).fixAllInGroup!(context);
        }
    }

    //!
    export function createCodeActionAll(changes: FileTextChanges[], commands?: CodeActionCommand[]): CodeActionAll { //mv
        return { changes, commands };
    }

    export function createFileTextChanges(fileName: string, textChanges: TextChange[]): FileTextChanges { //reuse
        return { fileName, textChanges };
    }

    //apply in reverse order so line info isn't effected by previous changes.
    //dup?
    //kill?
    //See dup in textChanges.ts `normalize`
    export function sortTextChanges(changes: TextChange[]): TextChange[] {//reuse
        return changes.sort((a, b) => b.span.start - a.span.start);
    }

    //mv
    //review -- maybe always use text changes and kill this
    export function fixAllSimple(context: CodeFixAllContext, errorCodes: number[], getCodeAction: (context: CodeFixContext) => { changes: ReadonlyArray<FileTextChanges>, commands?: ReadonlyArray<CodeActionCommand> } | undefined): CodeActionAll {
        const errors = context.program.getSemanticDiagnostics();
        const allChanges = createMultiMap<TextChange>(); // file to changes
        let allCommands: CodeActionCommand[] | undefined;
        for (const error of errors) {
            if (contains(errorCodes, error.code)) {
                Debug.assert(error.start !== undefined && error.length !== undefined);
                const { changes, commands } = getCodeAction({
                    formatContext: context.formatContext,
                    newLineCharacter: context.newLineCharacter,
                    sourceFile: context.sourceFile,
                    program: context.program,
                    host: context.host,
                    cancellationToken: context.cancellationToken,
                    errorCode: error.code,
                    span: ts.createTextSpan(error.start!, error.length!),
                });
                for (const change of changes) {
                    allChanges.addMany(change.fileName, change.textChanges);
                }
                allCommands = addRange(allCommands, commands);
            }
        }
        return { changes: arrayFrom(mapIterator(allChanges.entries(), ([fileName, changes]) => ({ fileName, textChanges: sortTextChanges(changes) }))), commands: allCommands };
    }

    //!
    export function makeSingle<T>(t: T | undefined): T[] {
        return t === undefined ? undefined : [t];
    }

    export function iterateErrorsForCodeActionAll(context: CodeFixAllContext, errorCodes: number[], use: (changes: textChanges.ChangeTracker, error: Diagnostic) => void): CodeActionAll {
        return createCodeActionAll(textChanges.ChangeTracker.with(context, t => {
            each(errorsIterator(context.program, context.sourceFile, errorCodes), e => use(t, e));
        }));
    }

    //!
    export function each<T>(iter: Iterator<T>, cb: (t: T) => void): void {
        while (true) {
            const { value, done } = iter.next();
            if (done) return;
            cb(value);
        }
    }

    //!
    export function errorsIterator(program: Program, sourceFile: SourceFile, errorCodes: number[]): Iterator<Diagnostic> { //todo: iterator
        return filterIterator(arrayIterator(program.getSemanticDiagnostics()), error =>
            contains(errorCodes, error.code) && error.file === sourceFile);
    }
}
