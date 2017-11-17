/* @internal */
namespace ts.codefix {
    const groupId = "extendsInterfaceBecomesImplements";
    const errorCodes = [Diagnostics.Cannot_extend_an_interface_0_Did_you_mean_implements.code];
    registerCodeFix({
        errorCodes,
        getCodeActions: context => {
            const { sourceFile } = context;
            const nodes = getNodes(sourceFile, context.span.start);
            if (!nodes) return undefined;
            const { extendsToken, heritageClauses } = nodes;
            const changes = textChanges.ChangeTracker.with(context, t => doChanges(t, sourceFile, extendsToken, heritageClauses));
            return [{ description: getLocaleSpecificMessage(Diagnostics.Change_extends_to_implements), changes, groupId }];
        },
        groupIds: [groupId],
        //NOTE: e.file === context.sourceFile -- make this pattern neater
        fixAllInGroup: context => iterateErrorsForCodeActionAll(context, errorCodes, (changes, e) => {
            const nodes = getNodes(e.file, e.start!);
            if (nodes) doChanges(changes, context.sourceFile, nodes.extendsToken, nodes.heritageClauses);
        }),
    });

    function getNodes(sourceFile: SourceFile, pos: number) {
        const token = getTokenAtPosition(sourceFile, pos, /*includeJsDocComment*/ false);
        const heritageClauses = getContainingClass(token)!.heritageClauses;
        const extendsToken = heritageClauses[0].getFirstToken();
        return extendsToken.kind === SyntaxKind.ExtendsKeyword ? { extendsToken, heritageClauses } : undefined;
    }

    function doChanges(changes: textChanges.ChangeTracker, sourceFile: SourceFile, extendsToken: Node, heritageClauses: ReadonlyArray<HeritageClause>): void {
        changes.replaceNode(sourceFile, extendsToken, createToken(SyntaxKind.ImplementsKeyword));
        // We replace existing keywords with commas.
        for (let i = 1; i < heritageClauses.length; i++) {
            const keywordToken = heritageClauses[i].getFirstToken()!;
            changes.replaceNode(sourceFile, keywordToken, createToken(SyntaxKind.CommaToken));
        }
    }
}
