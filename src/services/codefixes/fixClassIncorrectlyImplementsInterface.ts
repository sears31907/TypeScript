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

        return mapDefined<ExpressionWithTypeArguments, CodeAction>(getClassImplementsHeritageClauseElements(classDeclaration), implementedTypeNode => {
            const changes = textChanges.ChangeTracker.with(context, t => foo(checker, implementedTypeNode, sourceFile, classDeclaration, context.newLineCharacter, t));
            if (changes.length === 0) return undefined;
            const description = formatStringFromArgs(getLocaleSpecificMessage(Diagnostics.Implement_interface_0), [implementedTypeNode.getText()]);
            return { description, changes };
        });
    }

    function foo(checker: TypeChecker, implementedTypeNode: ExpressionWithTypeArguments, sourceFile: SourceFile, classDeclaration: ClassLikeDeclaration, newLineCharacter: string, changeTracker: textChanges.ChangeTracker): void {
        // Note that this is ultimately derived from a map indexed by symbol names,
        // so duplicates cannot occur.
        const implementedType = checker.getTypeAtLocation(implementedTypeNode) as InterfaceType;
        const implementedTypeSymbols = checker.getPropertiesOfType(implementedType);
        const nonPrivateMembers = implementedTypeSymbols.filter(symbol => !(getModifierFlags(symbol.valueDeclaration) & ModifierFlags.Private));

        const classType = checker.getTypeAtLocation(classDeclaration);

        const hasNumericIndexSignature = !!checker.getIndexTypeOfType(classType, IndexKind.Number); //inline
        const hasStringIndexSignature = !!checker.getIndexTypeOfType(classType, IndexKind.String); //inline

        const insert = createInsert(changeTracker, sourceFile, classDeclaration, newLineCharacter);

        if (!hasNumericIndexSignature) createMissingIndexSignatureDeclaration(implementedType, IndexKind.Number);
        if (!hasStringIndexSignature) createMissingIndexSignatureDeclaration(implementedType, IndexKind.String);

        createMissingMemberNodes(classDeclaration, nonPrivateMembers, checker, insert);

        function createMissingIndexSignatureDeclaration(type: InterfaceType, kind: IndexKind): void {
            const indexInfoOfKind = checker.getIndexInfoOfType(type, kind);
            if (indexInfoOfKind) {
                insert(checker.indexInfoToIndexSignatureDeclaration(indexInfoOfKind, kind, classDeclaration));
            }
        }
    }
}