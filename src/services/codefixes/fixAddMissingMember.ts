/* @internal */
namespace ts.codefix {
    const errorCodes = [
        Diagnostics.Property_0_does_not_exist_on_type_1.code,
        Diagnostics.Property_0_does_not_exist_on_type_1_Did_you_mean_2.code,
    ];
    const groupId = "addMissingMember";
    registerCodeFix({
        errorCodes,
        getCodeActions(context) {
            const info = getInfo(context.sourceFile, context.span.start, context.program.getTypeChecker());
            if (!info) return undefined;
            const { classDeclaration, makeStatic, token } = info;

            const classDeclarationSourceFile = classDeclaration.getSourceFile();
            const classOpenBrace = getOpenBraceOfClassLike(classDeclaration, classDeclarationSourceFile);

            const inJs = isInJavaScriptFile(classDeclarationSourceFile);
            const methodCodeAction = getActionForMethodDeclaration(context, classDeclarationSourceFile, classOpenBrace, token, makeStatic, /*includeTypeScriptSyntax*/ !inJs);
            const addMember = inJs ?
                makeSingle(getActionsForAddMissingMemberInJavaScriptFile(context, classDeclarationSourceFile, token.text, classDeclaration, makeStatic)) :
                getActionsForAddMissingMemberInTypeScriptFile(context, classDeclarationSourceFile, classOpenBrace, token, token.text, classDeclaration, makeStatic);
            return concatenate(makeSingle(methodCodeAction), addMember);
        },
        groupIds: [groupId],
        fixAllInGroup: context => {
            iterateErrorsForCodeActionAll(context, errorCodes, (_changes, _err) => {
                //const info = getInfo(err.file!, err.start!, context.program.getTypeChecker());
            });
            throw new Error("TODO");
        },
    });

    function getInfo(tokenSourceFile: SourceFile, tokenPos: number, checker: TypeChecker): { readonly classDeclaration: ClassLikeDeclaration, readonly makeStatic: boolean, readonly token: Identifier } | undefined {
        // The identifier of the missing property. eg:
        // this.missing = 1;
        //      ^^^^^^^
        const token = getTokenAtPosition(tokenSourceFile, tokenPos, /*includeJsDocComment*/ false);
        if (!isIdentifier(token)) {
            return undefined;
        }

        const { parent } = token;
        if (!isPropertyAccessExpression(parent)) {
            return undefined;
        }

        if (parent.expression.kind === SyntaxKind.ThisKeyword) {
            const containingClassMemberDeclaration = getThisContainer(token, /*includeArrowFunctions*/ false);
            if (!isClassElement(containingClassMemberDeclaration)) {
                return undefined;
            }
            const classDeclaration = containingClassMemberDeclaration.parent;
            // Property accesses on `this` in a static method are accesses of a static member.
            return isClassLike(classDeclaration) ? { classDeclaration, makeStatic: hasModifier(containingClassMemberDeclaration, ModifierFlags.Static), token } : undefined;
        }
        else {
            const leftExpression = parent.expression;
            const leftExpressionType = checker.getTypeAtLocation(leftExpression);
            const symbol = leftExpressionType.symbol;
            if (!(leftExpressionType.flags & TypeFlags.Object && symbol.flags & SymbolFlags.Class)) return undefined;
            const classDeclaration = symbol.declarations && <ClassLikeDeclaration>symbol.declarations[0]; //! what if an interface comes first?
            // The expression is a class symbol but the type is not the instance-side.
            return { classDeclaration, makeStatic: leftExpressionType !== checker.getDeclaredTypeOfSymbol(symbol), token };
        }
    }

    function getActionsForAddMissingMemberInJavaScriptFile(context: CodeFixContext, classDeclarationSourceFile: SourceFile, tokenName: string,classDeclaration: ClassLikeDeclaration, makeStatic: boolean): CodeAction | undefined {
        if (makeStatic) {
            if (classDeclaration.kind === SyntaxKind.ClassExpression) {
                return undefined;
            }

            const className = classDeclaration.name.getText();

            const staticInitialization = createStatement(createAssignment(
                createPropertyAccess(createIdentifier(className), tokenName),
                createIdentifier("undefined")));

            const changes = textChanges.ChangeTracker.with(context, t => t.insertNodeAfter(
                classDeclarationSourceFile,
                classDeclaration,
                staticInitialization,
                { prefix: context.newLineCharacter, suffix: context.newLineCharacter }));
            const description = formatStringFromArgs(getLocaleSpecificMessage(Diagnostics.Initialize_static_property_0), [tokenName]);
            return { description, changes, groupId };
        }
        else {
            const classConstructor = getFirstConstructorWithBody(classDeclaration);
            if (!classConstructor) {
                return undefined;
            }

            const propertyInitialization = createStatement(createAssignment(
                createPropertyAccess(createThis(), tokenName),
                createIdentifier("undefined")));

            const description = formatStringFromArgs(getLocaleSpecificMessage(Diagnostics.Initialize_property_0_in_the_constructor), [tokenName]);
            const changes = textChanges.ChangeTracker.with(context, t => t.insertNodeBefore(
                classDeclarationSourceFile,
                classConstructor.body.getLastToken(),
                propertyInitialization,
                { suffix: context.newLineCharacter }));
            return { description, changes, groupId };
        }
    }

    //this adds a property declaration, or index signature declaration
    function getActionsForAddMissingMemberInTypeScriptFile(context: CodeFixContext, classDeclarationSourceFile: SourceFile, classOpenBrace: Node, token: Node, tokenName: string, classDeclaration: ClassLikeDeclaration, makeStatic: boolean): CodeAction[] | undefined {
        const typeNode = sss(context, classDeclaration, token)
        const addProp = createAddPropertyDeclarationAction(context, classDeclarationSourceFile, classOpenBrace, makeStatic, tokenName, typeNode);
        return makeStatic ? [addProp] : [addProp, createAddIndexSignatureAction(context, classDeclarationSourceFile, classOpenBrace, tokenName, typeNode)];
    }

    function sss(context: CodeFixContext, classDeclaration: ClassLikeDeclaration, token: Node) {
        let typeNode: TypeNode;
        if (token.parent.parent.kind === SyntaxKind.BinaryExpression) {
            const binaryExpression = token.parent.parent as BinaryExpression;
            const otherExpression = token.parent === binaryExpression.left ? binaryExpression.right : binaryExpression.left;
            const checker = context.program.getTypeChecker();
            const widenedType = checker.getWidenedType(checker.getBaseTypeOfLiteralType(checker.getTypeAtLocation(otherExpression)));
            typeNode = checker.typeToTypeNode(widenedType, classDeclaration);
        }
        return typeNode || createKeywordTypeNode(SyntaxKind.AnyKeyword);
    }

    function createAddPropertyDeclarationAction(context: CodeFixContext, classDeclarationSourceFile: SourceFile, classOpenBrace: Node, makeStatic: boolean, tokenName: string, typeNode: TypeNode): CodeAction {
        const property = createProperty(
            /*decorators*/undefined,
            /*modifiers*/ makeStatic ? [createToken(SyntaxKind.StaticKeyword)] : undefined,
            tokenName,
            /*questionToken*/ undefined,
            typeNode,
            /*initializer*/ undefined);
        const changes = textChanges.ChangeTracker.with(context, t => t.insertNodeAfter(classDeclarationSourceFile, classOpenBrace, property, { suffix: context.newLineCharacter }));
        const description = formatStringFromArgs(getLocaleSpecificMessage(makeStatic ? Diagnostics.Declare_static_property_0 : Diagnostics.Declare_property_0), [tokenName]);
        return { description, changes, groupId };
    }

    function createAddIndexSignatureAction(context: CodeFixContext, classDeclarationSourceFile: SourceFile, classOpenBrace: Node, tokenName: string, typeNode: TypeNode): CodeAction {
        // Index signatures cannot have the static modifier.
        const stringTypeNode = createKeywordTypeNode(SyntaxKind.StringKeyword);
        const indexingParameter = createParameter(
            /*decorators*/ undefined,
            /*modifiers*/ undefined,
            /*dotDotDotToken*/ undefined,
            "x",
            /*questionToken*/ undefined,
            stringTypeNode,
            /*initializer*/ undefined);
        const indexSignature = createIndexSignature(
            /*decorators*/ undefined,
            /*modifiers*/ undefined,
            [indexingParameter],
            typeNode);

        const changes = textChanges.ChangeTracker.with(context, t => t.insertNodeAfter(classDeclarationSourceFile, classOpenBrace, indexSignature, { suffix: context.newLineCharacter }));
        return { description: formatStringFromArgs(getLocaleSpecificMessage(Diagnostics.Add_index_signature_for_property_0), [tokenName]), changes };
    }

    function getActionForMethodDeclaration(context: CodeFixContext, classDeclarationSourceFile: SourceFile, classOpenBrace: Node, token: Identifier, makeStatic: boolean, includeTypeScriptSyntax: boolean): CodeAction | undefined {
        if (token.parent.parent.kind !== SyntaxKind.CallExpression) {
            return undefined;
        }

        const callExpression = <CallExpression>token.parent.parent;
        const methodDeclaration = createMethodFromCallExpression(callExpression, token.text, includeTypeScriptSyntax, makeStatic);

        const changes = textChanges.ChangeTracker.with(context, t => t.insertNodeAfter(classDeclarationSourceFile, classOpenBrace, methodDeclaration, { suffix: context.newLineCharacter }));
        const diag = makeStatic ? Diagnostics.Declare_static_method_0 : Diagnostics.Declare_method_0;
        return { description: formatStringFromArgs(getLocaleSpecificMessage(diag), [token.text]), changes };
    }
}
