/* @internal */
namespace ts.codefix {
    const groupId = "classSuperMustPrecedeThisAccess";
    const errorCodes = [Diagnostics.super_must_be_called_before_accessing_this_in_the_constructor_of_a_derived_class.code];
    registerCodeFix({
        errorCodes,
        getCodeActions(context) {
            const { sourceFile } = context;
            const nodes = getNodes(sourceFile, context.span.start);
            if (!nodes) return undefined;
            const { constructor, superCall } = nodes;
            const changes = textChanges.ChangeTracker.with(context, t => doChange(t, sourceFile, constructor, superCall, context.newLineCharacter));
            return [{ description: getLocaleSpecificMessage(Diagnostics.Make_super_call_the_first_statement_in_the_constructor), changes, groupId }];
        },
        groupIds: [groupId],
        fixAllInGroup(context) {
            const { newLineCharacter, sourceFile } = context;
            const seenClasses: true[] = []; // Ensure we only do this once per class.
            return iterateErrorsForCodeActionAll(context, errorCodes, (changes, e) => {
                const nodes = getNodes(e.file, e.start);
                if (!nodes) return;
                const { constructor, superCall } = nodes;
                if (addToSeenIds(seenClasses, getNodeId(constructor.parent))) {
                    doChange(changes, sourceFile, constructor, superCall, newLineCharacter);
                }
            });
        },
    });

    function doChange(changes: textChanges.ChangeTracker, sourceFile: SourceFile, constructor: ConstructorDeclaration, superCall: ExpressionStatement, newLineCharacter: string): void {
        changes.insertNodeAfter(sourceFile, getOpenBrace(constructor, sourceFile), superCall, { suffix: newLineCharacter });
        changes.deleteNode(sourceFile, superCall);
    }

    function getNodes(sourceFile: SourceFile, pos: number) {
        const token = getTokenAtPosition(sourceFile, pos, /*includeJsDocComment*/ false);
        Debug.assert(token.kind === SyntaxKind.ThisKeyword);
        const constructor = getContainingFunction(token) as ConstructorDeclaration;
        const superCall = findSuperCall(constructor.body);
        // figure out if the `this` access is actually inside the supercall
        // i.e. super(this.a), since in that case we won't suggest a fix
        return superCall && !superCall.expression.arguments.some(arg => isPropertyAccessExpression(arg) && arg.expression === token) ? { constructor, superCall } : undefined;
    }

    function findSuperCall(n: Node): ExpressionStatement & { expression: CallExpression } | undefined {
        return isExpressionStatement(n) && isSuperCall(n.expression)
            ? n as ExpressionStatement & { expression: CallExpression }
            : isFunctionLike(n)
                ? undefined
                : forEachChild(n, findSuperCall);
    }
}
