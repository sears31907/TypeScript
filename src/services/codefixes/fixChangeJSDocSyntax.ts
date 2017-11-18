/* @internal */
namespace ts.codefix {
    const groupId_plain = "fixJSDocTypes_plain";
    const groupId_nullable = "fixJSDocTypes_nullable";
    const errorCodes = [Diagnostics.JSDoc_types_can_only_be_used_inside_documentation_comments.code];
    registerCodeFix({
        errorCodes,
        getCodeActions(context) {
            const { sourceFile } = context;
            const checker = context.program.getTypeChecker();
            const info = getInfo(sourceFile, context.span.start, checker);
            if (!info) return undefined;
            const { typeNode, type } = info;
            const original = typeNode.getText(sourceFile);
            const actions = [action(type, groupId_plain)];
            if (typeNode.kind === SyntaxKind.JSDocNullableType) {
                // for nullable types, suggest the flow-compatible `T | null | undefined`
                // in addition to the jsdoc/closure-compatible `T | null`
                actions.push(action(checker.getNullableType(type, TypeFlags.Undefined), groupId_nullable));
            }
            return actions;

            function action(type: Type, groupId: string): CodeAction {
                const newText = typeString(type, checker);
                return {
                    description: formatStringFromArgs(getLocaleSpecificMessage(Diagnostics.Change_0_to_1), [original, newText]),
                    changes: [createFileTextChanges(sourceFile.fileName, [createChange(typeNode, sourceFile, newText)])],
                    groupId,
                };
            }
        },
        groupIds: [groupId_plain, groupId_nullable],
        fixAllInGroup(context) {
            const { groupId, program, sourceFile } = context;
            const checker = program.getTypeChecker();
            const changes = mapDefinedIter(errorsIterator(program, sourceFile, errorCodes), e => {
                const info = getInfo(e.file, e.start!, checker);
                if (!info) return undefined;
                const { typeNode, type } = info;
                const fixedType = typeNode.kind === SyntaxKind.JSDocNullableType && groupId === groupId_nullable ? checker.getNullableType(type, TypeFlags.Undefined) : type;
                return createChange(typeNode, sourceFile, typeString(fixedType, checker));
            });
            return createCodeActionAll([createFileTextChanges(sourceFile.fileName, changes)]); //dup
        }
    });

    function getInfo(sourceFile: SourceFile, pos: number, checker: TypeChecker): { readonly typeNode: TypeNode, type: Type } {
        const decl = findAncestor(getTokenAtPosition(sourceFile, pos, /*includeJsDocComment*/ false), isTypeContainer);
        const typeNode = decl && decl.type;
        return typeNode && { typeNode, type: checker.getTypeFromTypeNode(typeNode) };
    }

    function createChange(declaration: TypeNode, sourceFile: SourceFile, newText: string): TextChange {
        return { span: ts.createTextSpanFromBounds(declaration.getStart(sourceFile), declaration.getEnd()), newText: newText };
    }

    function typeString(type: Type, checker: TypeChecker): string {
        return checker.typeToString(type, /*enclosingDeclaration*/ undefined, TypeFormatFlags.NoTruncation)
    }

    //TODO: GH#19856 Node & { type: TypeNode }
    type TypeContainer =
        | AsExpression | CallSignatureDeclaration | ConstructSignatureDeclaration | FunctionDeclaration
        | GetAccessorDeclaration | IndexSignatureDeclaration | MappedTypeNode | MethodDeclaration
        | MethodSignature | ParameterDeclaration | PropertyDeclaration | PropertySignature | SetAccessorDeclaration
        | TypeAliasDeclaration | TypeAssertion | VariableDeclaration;
    function isTypeContainer(node: Node): node is TypeContainer {
        // NOTE: Some locations are not handled yet:
        // MappedTypeNode.typeParameters and SignatureDeclaration.typeParameters, as well as CallExpression.typeArguments
        switch (node.kind) {
            case SyntaxKind.AsExpression:
            case SyntaxKind.CallSignature:
            case SyntaxKind.ConstructSignature:
            case SyntaxKind.FunctionDeclaration:
            case SyntaxKind.GetAccessor:
            case SyntaxKind.IndexSignature:
            case SyntaxKind.MappedType:
            case SyntaxKind.MethodDeclaration:
            case SyntaxKind.MethodSignature:
            case SyntaxKind.Parameter:
            case SyntaxKind.PropertyDeclaration:
            case SyntaxKind.PropertySignature:
            case SyntaxKind.SetAccessor:
            case SyntaxKind.TypeAliasDeclaration:
            case SyntaxKind.TypeAssertionExpression:
            case SyntaxKind.VariableDeclaration:
                return true;
            default:
                return false;
        }
    }
}
