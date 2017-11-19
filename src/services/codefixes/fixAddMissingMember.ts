/* @internal */
namespace ts.codefix {
    //todo: group? but that would affect other files...
    registerCodeFix({
        errorCodes: [Diagnostics.Property_0_does_not_exist_on_type_1.code,
                     Diagnostics.Property_0_does_not_exist_on_type_1_Did_you_mean_2.code],
        getCodeActions: getActionsForAddMissingMember
    });

    function getActionsForAddMissingMember(context: CodeFixContext): CodeAction[] | undefined {
        const tokenSourceFile = context.sourceFile;
        const start = context.span.start;
        // The identifier of the missing property. eg:
        // this.missing = 1;
        //      ^^^^^^^
        const token = getTokenAtPosition(tokenSourceFile, start, /*includeJsDocComment*/ false);

        if (!isIdentifier(token)) {
            return undefined;
        }

        if (!isPropertyAccessExpression(token.parent)) {
            return undefined;
        }

        const info = getInfo(token, token.parent, context.program.getTypeChecker());
        if (!info) return undefined;
        const { classDeclaration, makeStatic } = info;

        const classDeclarationSourceFile = classDeclaration.getSourceFile();
        const classOpenBrace = getOpenBraceOfClassLike(classDeclaration, classDeclarationSourceFile);

        const inJs = isInJavaScriptFile(classDeclarationSourceFile);
        const methodCodeAction = getActionForMethodDeclaration(context, classDeclarationSourceFile, classOpenBrace, token, makeStatic, /*includeTypeScriptSyntax*/ !inJs);
        const x = inJs ? //name
            getActionsForAddMissingMemberInJavaScriptFile(context, classDeclarationSourceFile, token.text, classDeclaration, makeStatic) :
            getActionsForAddMissingMemberInTypeScriptFile(context, classDeclarationSourceFile, classOpenBrace, token, token.text, classDeclaration, makeStatic);
        return concatenate(makeSingle(methodCodeAction), x);
    }

    //!
    function getInfo(token: Identifier, parent: PropertyAccessExpression, checker: TypeChecker): { readonly classDeclaration: ClassLikeDeclaration, makeStatic: boolean } {
        if (parent.expression.kind === SyntaxKind.ThisKeyword) {
            const containingClassMemberDeclaration = getThisContainer(token, /*includeArrowFunctions*/ false);
            if (!isClassElement(containingClassMemberDeclaration)) {
                return undefined;
            }
            const classDeclaration = containingClassMemberDeclaration.parent;
            // Property accesses on `this` in a static method are accesses of a static member.
            return isClassLike(classDeclaration) ? { classDeclaration, makeStatic: hasModifier(containingClassMemberDeclaration, ModifierFlags.Static) } : undefined;
        }
        else {
            const leftExpression = parent.expression;
            const leftExpressionType = checker.getTypeAtLocation(leftExpression);
            const symbol = leftExpressionType.symbol;
            if (!(leftExpressionType.flags & TypeFlags.Object && symbol.flags & SymbolFlags.Class)) return undefined;
            const classDeclaration = symbol.declarations && <ClassLikeDeclaration>symbol.declarations[0]; //! what if an interface comes first?
            // The expression is a class symbol but the type is not the instance-side.
            return { classDeclaration, makeStatic: leftExpressionType !== checker.getDeclaredTypeOfSymbol(symbol) };
        }
    }

    function getActionsForAddMissingMemberInJavaScriptFile(context: CodeFixContext, classDeclarationSourceFile: SourceFile, tokenName: string,classDeclaration: ClassLikeDeclaration, makeStatic: boolean): CodeAction[] | undefined {
        if (makeStatic) {
            if (classDeclaration.kind === SyntaxKind.ClassExpression) {
                return undefined;
            }

            const className = classDeclaration.name.getText();

            const staticInitialization = createStatement(createAssignment(
                createPropertyAccess(createIdentifier(className), tokenName),
                createIdentifier("undefined")));

            const staticInitializationChangeTracker = textChanges.ChangeTracker.fromContext(context);
            staticInitializationChangeTracker.insertNodeAfter(
                classDeclarationSourceFile,
                classDeclaration,
                staticInitialization,
                { prefix: context.newLineCharacter, suffix: context.newLineCharacter });
            return [{
                description: formatStringFromArgs(getLocaleSpecificMessage(Diagnostics.Initialize_static_property_0), [tokenName]),
                changes: staticInitializationChangeTracker.getChanges()
            }];
        }
        else {
            const classConstructor = getFirstConstructorWithBody(classDeclaration);
            if (!classConstructor) {
                return undefined;
            }

            const propertyInitialization = createStatement(createAssignment(
                createPropertyAccess(createThis(), tokenName),
                createIdentifier("undefined")));

            const propertyInitializationChangeTracker = textChanges.ChangeTracker.fromContext(context);
            propertyInitializationChangeTracker.insertNodeBefore(
                classDeclarationSourceFile,
                classConstructor.body.getLastToken(),
                propertyInitialization,
                { suffix: context.newLineCharacter });

            return [{
                description: formatStringFromArgs(getLocaleSpecificMessage(Diagnostics.Initialize_property_0_in_the_constructor), [tokenName]),
                changes: propertyInitializationChangeTracker.getChanges()
            }];
        }
    }

    function getActionsForAddMissingMemberInTypeScriptFile(context: CodeFixContext, classDeclarationSourceFile: SourceFile, classOpenBrace: Node, token: Node, tokenName: string, classDeclaration: ClassLikeDeclaration, makeStatic: boolean): CodeAction[] | undefined {
        const actions = [];

        let typeNode: TypeNode;
        if (token.parent.parent.kind === SyntaxKind.BinaryExpression) {
            const binaryExpression = token.parent.parent as BinaryExpression;
            const otherExpression = token.parent === binaryExpression.left ? binaryExpression.right : binaryExpression.left;
            const checker = context.program.getTypeChecker();
            const widenedType = checker.getWidenedType(checker.getBaseTypeOfLiteralType(checker.getTypeAtLocation(otherExpression)));
            typeNode = checker.typeToTypeNode(widenedType, classDeclaration);
        }
        typeNode = typeNode || createKeywordTypeNode(SyntaxKind.AnyKeyword);

        const property = createProperty(
            /*decorators*/undefined,
            /*modifiers*/ makeStatic ? [createToken(SyntaxKind.StaticKeyword)] : undefined,
            tokenName,
            /*questionToken*/ undefined,
            typeNode,
            /*initializer*/ undefined);
        const propertyChangeTracker = textChanges.ChangeTracker.fromContext(context);
        propertyChangeTracker.insertNodeAfter(classDeclarationSourceFile, classOpenBrace, property, { suffix: context.newLineCharacter });

        const diag = makeStatic ? Diagnostics.Declare_static_property_0 : Diagnostics.Declare_property_0;
        actions.push({
            description: formatStringFromArgs(getLocaleSpecificMessage(diag), [tokenName]),
            changes: propertyChangeTracker.getChanges()
        });

        if (!makeStatic) {
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

            const indexSignatureChangeTracker = textChanges.ChangeTracker.fromContext(context);
            indexSignatureChangeTracker.insertNodeAfter(classDeclarationSourceFile, classOpenBrace, indexSignature, { suffix: context.newLineCharacter });

            actions.push({
                description: formatStringFromArgs(getLocaleSpecificMessage(Diagnostics.Add_index_signature_for_property_0), [tokenName]),
                changes: indexSignatureChangeTracker.getChanges()
            });
        }

        return actions;
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
