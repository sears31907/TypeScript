/* @internal */
namespace ts.codefix {
    const errorCodes = [Diagnostics.Class_0_incorrectly_implements_interface_1.code];
    const groupId = "fixClassIncorrectlyImplementsInterface"; //todo: share a group with fixClassDoesntImplementInheritedAbstractMember?
    registerCodeFix({
        errorCodes,
        getCodeActions(context) {
            const { newLineCharacter, program, sourceFile, span } = context;
            const classDeclaration = getClass(sourceFile, span.start);
            const checker = program.getTypeChecker();
            return mapDefined<ExpressionWithTypeArguments, CodeFix>(getClassImplementsHeritageClauseElements(classDeclaration), implementedTypeNode => {
                const changes = textChanges.ChangeTracker.with(context, t => addMissingDeclarations(checker, implementedTypeNode, sourceFile, classDeclaration, newLineCharacter, t));
                if (changes.length === 0) return undefined;
                const description = formatStringFromArgs(getLocaleSpecificMessage(Diagnostics.Implement_interface_0), [implementedTypeNode.getText()]);
                return { description, changes, groupId };
            });
        },
        groupIds: [groupId],
        fixAllInGroup(context) {
            const seenClassDeclarations: true[] = [];
            return iterateErrorsForCodeActionAll(context, errorCodes, (changes, err) => {
                const classDeclaration = getClass(err.file!, err.start!);
                if (addToSeenIds(seenClassDeclarations, getNodeId(classDeclaration))) {
                    for (const implementedTypeNode of getClassImplementsHeritageClauseElements(classDeclaration)) {
                        addMissingDeclarations(context.program.getTypeChecker(), implementedTypeNode, err.file!, classDeclaration, context.newLineCharacter, changes);
                    }
                }
            });
        },
    });

    function getClass(sourceFile: SourceFile, pos: number): ClassLikeDeclaration {
        const classDeclaration = getContainingClass(getTokenAtPosition(sourceFile, pos, /*includeJsDocComment*/ false));
        Debug.assert(!!classDeclaration);
        return classDeclaration!;
    }

    function addMissingDeclarations(
        checker: TypeChecker,
        implementedTypeNode: ExpressionWithTypeArguments,
        sourceFile: SourceFile,
        classDeclaration: ClassLikeDeclaration,
        newLineCharacter: string,
        changeTracker: textChanges.ChangeTracker
    ): void {
        // Note that this is ultimately derived from a map indexed by symbol names,
        // so duplicates cannot occur.
        const implementedType = checker.getTypeAtLocation(implementedTypeNode) as InterfaceType;
        const implementedTypeSymbols = checker.getPropertiesOfType(implementedType);
        const nonPrivateMembers = implementedTypeSymbols.filter(symbol => !(getModifierFlags(symbol.valueDeclaration) & ModifierFlags.Private));

        const classType = checker.getTypeAtLocation(classDeclaration);

        const hasNumericIndexSignature = !!checker.getIndexTypeOfType(classType, IndexKind.Number); //inline
        const hasStringIndexSignature = !!checker.getIndexTypeOfType(classType, IndexKind.String); //inline

        const insert = addNewMemberToClass(changeTracker, sourceFile, classDeclaration, newLineCharacter);

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
