/* @internal */
namespace ts.codefix {
    const groupId = "addMissingInvocationForDecorator";
    const errorCodes = [Diagnostics._0_accepts_too_few_arguments_to_be_used_as_a_decorator_here_Did_you_mean_to_call_it_first_and_write_0.code];
    registerCodeFix({
        errorCodes,
        getCodeActions: context => [getCodeAction(context)],
        groupIds: [groupId],
        fixAllInGroup: context => fixAllSimple(context, errorCodes, getCodeAction),
    });

    function getCodeAction(context: CodeFixContext): CodeAction {
        const sourceFile = context.sourceFile;
        const token = getTokenAtPosition(sourceFile, context.span.start, /*includeJsDocComment*/ false);
        const decorator = getAncestor(token, SyntaxKind.Decorator) as Decorator;
        Debug.assert(!!decorator, "Expected position to be owned by a decorator.");
        const replacement = createCall(decorator.expression, /*typeArguments*/ undefined, /*argumentsArray*/ undefined);
        const changes = textChanges.ChangeTracker.with(context, t => t.replaceNode(sourceFile, decorator.expression, replacement));

        return { description: getLocaleSpecificMessage(Diagnostics.Call_decorator_expression), changes, groupId };
    }
}
