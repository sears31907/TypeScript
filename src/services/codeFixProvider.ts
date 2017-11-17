/* @internal */
namespace ts {
    export interface CodeFix {
        errorCodes: number[];
        getCodeActions(context: CodeFixContext): CodeAction[] | undefined;
        groupIds?: string[];
        fixAllInGroup?(context: CodeFixAllContext): CodeActionAll;
        //TODO: nonOptional
    }

    //name
    export interface CodeFixContextBase extends textChanges.TextChangesContext {
        sourceFile: SourceFile;
        program: Program;
        host: LanguageServiceHost;
        cancellationToken: CancellationToken;
    }

    export interface CodeFixAllContext extends CodeFixContextBase {
        groupId: string;
    }

    export interface CodeFixContext extends CodeFixContextBase {
        errorCode: number;
        span: TextSpan;
    }

    export namespace codefix {
        const codeFixes: CodeFix[][] = [];
        const groups = createMap<CodeFix>();

        export function registerCodeFix(codeFix: CodeFix) {
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

        export function getFixes(context: CodeFixContext): CodeAction[] {
            const fixes = codeFixes[context.errorCode];
            const allActions: CodeAction[] = [];

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
            const fix = groups.get(context.groupId); //inline
            return fix.fixAllInGroup!(context);
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
        return { changes: mapIter(allChanges.entries(), ([fileName, changes]) => ({ fileName, textChanges: sortTextChanges(changes) })), commands: allCommands };
    }

    //!
    export function makeSingle<T>(t: T | undefined): T[] {
        return t === undefined ? undefined : [t];
    }

    //name
    export function iterateErrorsForCodeActionAll(context: CodeFixAllContext, errorCodes: number[], use: (changes: textChanges.ChangeTracker, error: Diagnostic) => void): CodeActionAll {
        return createCodeActionAll(textChanges.ChangeTracker.with(context, t => {
            for (const error of errorsIter(context.program, context.sourceFile, errorCodes)) {
                use(t, error); //neater
            }
        }));
    }

    //!
    export function errorsIter(program: Program, sourceFile: SourceFile, errorCodes: number[]): Diagnostic[] { //todo: iterator
        return program.getSemanticDiagnostics().filter(error => contains(errorCodes, error.code) && error.file === sourceFile);
    }
}
