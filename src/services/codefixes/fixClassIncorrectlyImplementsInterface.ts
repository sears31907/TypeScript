/* @internal */
namespace ts.codefix {
    //todo: group
    registerCodeFix({
        errorCodes: [Diagnostics.Class_0_incorrectly_implements_interface_1.code],
        getCodeActions: getActionForClassLikeIncorrectImplementsInterface
    });

    function getActionForClassLikeIncorrectImplementsInterface(context: CodeFixContext): CodeAction[] | undefined {
        const sourceFile = context.sourceFile;
        const start = context.span.start;
        const token = getTokenAtPosition(sourceFile, start, /*includeJsDocComment*/ false);
        const checker = context.program.getTypeChecker();

        const classDeclaration = getContainingClass(token);
        Debug.assert(!!classDeclaration);

        const classType = checker.getTypeAtLocation(classDeclaration);

        const hasNumericIndexSignature = !!checker.getIndexTypeOfType(classType, IndexKind.Number);
        const hasStringIndexSignature = !!checker.getIndexTypeOfType(classType, IndexKind.String);

        return mapDefined<ExpressionWithTypeArguments, CodeAction>(getClassImplementsHeritageClauseElements(classDeclaration), implementedTypeNode => {
            // Note that this is ultimately derived from a map indexed by symbol names,
            // so duplicates cannot occur.
            const implementedType = checker.getTypeAtLocation(implementedTypeNode) as InterfaceType;
            const implementedTypeSymbols = checker.getPropertiesOfType(implementedType);
            const nonPrivateMembers = implementedTypeSymbols.filter(symbol => !(getModifierFlags(symbol.valueDeclaration) & ModifierFlags.Private));

            let newNodes: Node[] = [];
            if (!hasNumericIndexSignature) append(newNodes, createMissingIndexSignatureDeclaration(implementedType, IndexKind.Number));
            if (!hasStringIndexSignature) append(newNodes, createMissingIndexSignatureDeclaration(implementedType, IndexKind.String));
            addRange(newNodes, createMissingMemberNodes(classDeclaration, nonPrivateMembers, checker));
            if (newNodes.length === 0) {
                return undefined;
            }

            const description = formatStringFromArgs(getLocaleSpecificMessage(Diagnostics.Implement_interface_0), [implementedTypeNode.getText()]);
            const changes = textChanges.ChangeTracker.with(context, t => newNodesToChanges(sourceFile, newNodes, getOpenBraceOfClassLike(classDeclaration, sourceFile), t, context.newLineCharacter));
            return { description, changes };
        });

        //use changetracker!
        function createMissingIndexSignatureDeclaration(type: InterfaceType, kind: IndexKind): Node | undefined {
            const indexInfoOfKind = checker.getIndexInfoOfType(type, kind);
            return indexInfoOfKind && checker.indexInfoToIndexSignatureDeclaration(indexInfoOfKind, kind, classDeclaration);
        }
    }
}