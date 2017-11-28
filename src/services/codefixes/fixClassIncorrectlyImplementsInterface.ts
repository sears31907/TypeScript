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
        if (!classDeclaration) {
            return undefined;
        }

        const openBrace = getOpenBraceOfClassLike(classDeclaration, sourceFile);
        const classType = checker.getTypeAtLocation(classDeclaration) as InterfaceType;
        const implementedTypeNodes = getClassImplementsHeritageClauseElements(classDeclaration);

        const hasNumericIndexSignature = !!checker.getIndexTypeOfType(classType, IndexKind.Number);
        const hasStringIndexSignature = !!checker.getIndexTypeOfType(classType, IndexKind.String);

        for (const implementedTypeNode of implementedTypeNodes) {
            // Note that this is ultimately derived from a map indexed by symbol names,
            // so duplicates cannot occur.
            const implementedType = checker.getTypeAtLocation(implementedTypeNode) as InterfaceType;
            const implementedTypeSymbols = checker.getPropertiesOfType(implementedType);
            const nonPrivateMembers = implementedTypeSymbols.filter(symbol => !(getModifierFlags(symbol.valueDeclaration) & ModifierFlags.Private));

            let newNodes: Node[] = [];
            createAndAddMissingIndexSignatureDeclaration(implementedType, IndexKind.Number, hasNumericIndexSignature, newNodes);
            createAndAddMissingIndexSignatureDeclaration(implementedType, IndexKind.String, hasStringIndexSignature, newNodes);
            addRange(newNodes, createMissingMemberNodes(classDeclaration, nonPrivateMembers, checker)));
            if (newNodes.length > 0) {
                const description = formatStringFromArgs(getLocaleSpecificMessage(Diagnostics.Implement_interface_0), [implementedTypeNode.getText()]);
                return [{ description, changes: newNodesToChanges(newNodes, openBrace, context) }];
            }
        }

        return [];

        function createAndAddMissingIndexSignatureDeclaration(type: InterfaceType, kind: IndexKind, hasIndexSigOfKind: boolean, newNodes: Node[]): void {
            if (hasIndexSigOfKind) {
                return;
            }

            const indexInfoOfKind = checker.getIndexInfoOfType(type, kind);

            if (!indexInfoOfKind) {
                return;
            }
            const newIndexSignatureDeclaration = checker.indexInfoToIndexSignatureDeclaration(indexInfoOfKind, kind, classDeclaration);
            newNodes.push(newIndexSignatureDeclaration);
        }
    }
}