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
            const { classDeclaration, classDeclarationSourceFile, classOpenBrace, inJs, makeStatic, token } = info;

            //dup-ish
            const methodCodeAction = !isCallExpression(token.parent.parent) ? undefined : getActionForMethodDeclaration(context, classDeclarationSourceFile, classOpenBrace, token, token.parent.parent, makeStatic, inJs);
            const addMember = inJs ?
                makeSingle(getActionsForAddMissingMemberInJavaScriptFile(context, classDeclarationSourceFile, token.text, classDeclaration, makeStatic)) :
                getActionsForAddMissingMemberInTypeScriptFile(context, classDeclarationSourceFile, classOpenBrace, token, classDeclaration, makeStatic);
            return concatenate(makeSingle(methodCodeAction), addMember);
        },
        groupIds: [groupId],
        fixAllInGroup: context => {
            iterateErrorsForCodeActionAll(context, errorCodes, (changes, err) => {
                const { newLineCharacter, program } = context;
                const info = getInfo(err.file!, err.start!, context.program.getTypeChecker());
                if (!info) return;
                const { classDeclaration, classDeclarationSourceFile, classOpenBrace, inJs, makeStatic, token } = info;

                // Always prefer to add a method declaration if possible.
                //test all branches!
                if (isCallExpression(token.parent.parent)) {
                    addMethodDeclaration(changes, classDeclarationSourceFile, classOpenBrace, token, token.parent.parent, newLineCharacter, makeStatic, inJs); //test
                }
                else {
                    if (inJs) {
                        addMissingMemberInJs(changes, classDeclarationSourceFile, token.text, classDeclaration, makeStatic, newLineCharacter); //test
                    }
                    else {
                        const typeNode = getTypeNode(program.getTypeChecker(), classDeclaration, token);
                        addPropertyDeclaration(changes, classDeclarationSourceFile, classOpenBrace, token.text, typeNode, makeStatic, newLineCharacter); //test
                    }
                }
            });
            throw new Error("TODO");
        },
    });

    function getInfo(tokenSourceFile: SourceFile, tokenPos: number, checker: TypeChecker) {
        // The identifier of the missing property. eg:
        // this.missing = 1;
        //      ^^^^^^^
        const token = getTokenAtPosition(tokenSourceFile, tokenPos, /*includeJsDocComment*/ false);
        if (!isIdentifier(token)) {
            return undefined;
        }

        const classAndMakeStatic = getClassAndMakeStatic(token, checker);
        if (!classAndMakeStatic) {
            return undefined;
        }
        const { classDeclaration, makeStatic } = classAndMakeStatic;
        const classDeclarationSourceFile = classDeclaration.getSourceFile();
        const classOpenBrace = getOpenBraceOfClassLike(classDeclaration, classDeclarationSourceFile);
        const inJs = isInJavaScriptFile(classDeclarationSourceFile);

        return { token, classDeclaration, makeStatic, classDeclarationSourceFile, classOpenBrace, inJs };
    }

    //annotate return type
    function getClassAndMakeStatic(token: Node, checker: TypeChecker) {
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

    function getActionsForAddMissingMemberInJavaScriptFile(context: CodeFixContext, classDeclarationSourceFile: SourceFile, tokenName: string, classDeclaration: ClassLikeDeclaration, makeStatic: boolean): CodeAction | undefined {
        const changes = textChanges.ChangeTracker.with(context, t => addMissingMemberInJs(t, classDeclarationSourceFile, tokenName, classDeclaration, makeStatic, context.newLineCharacter));
        if (changes.length === 0) return undefined;
        const description = formatStringFromArgs(getLocaleSpecificMessage(makeStatic ? Diagnostics.Initialize_static_property_0 : Diagnostics.Initialize_property_0_in_the_constructor), [tokenName]);
        return { description, changes, groupId };
    }

    function addMissingMemberInJs(changeTracker: textChanges.ChangeTracker, classDeclarationSourceFile: SourceFile, tokenName: string, classDeclaration: ClassLikeDeclaration, makeStatic: boolean, newLineCharacter: string): void {
        if (makeStatic) {
            if (classDeclaration.kind === SyntaxKind.ClassExpression) {
                return;
            }
            const className = classDeclaration.name.getText();
            const staticInitialization = initializePropertyToUndefined(createIdentifier(className), tokenName);
            changeTracker.insertNodeAfter(classDeclarationSourceFile, classDeclaration, staticInitialization, { prefix: newLineCharacter, suffix: newLineCharacter });
        }
        else {
            const classConstructor = getFirstConstructorWithBody(classDeclaration);
            if (!classConstructor) {
                return;
            }
            const propertyInitialization = initializePropertyToUndefined(createThis(), tokenName);
            changeTracker.insertNodeBefore(classDeclarationSourceFile, classConstructor.body.getLastToken(), propertyInitialization, { suffix: newLineCharacter });
        }
    }

    function initializePropertyToUndefined(obj: Expression, propertyName: string) {
        return createStatement(createAssignment(createPropertyAccess(obj, propertyName), createIdentifier("undefined")));
    }

    //this adds a property declaration, or index signature declaration
    function getActionsForAddMissingMemberInTypeScriptFile(context: CodeFixContext, classDeclarationSourceFile: SourceFile, classOpenBrace: Node, token: Identifier, classDeclaration: ClassLikeDeclaration, makeStatic: boolean): CodeAction[] | undefined {
        const typeNode = getTypeNode(context.program.getTypeChecker(), classDeclaration, token);
        const addProp = createAddPropertyDeclarationAction(context, classDeclarationSourceFile, classOpenBrace, makeStatic, token.text, typeNode);
        return makeStatic ? [addProp] : [addProp, createAddIndexSignatureAction(context, classDeclarationSourceFile, classOpenBrace, token.text, typeNode)];
    }

    function getTypeNode(checker: TypeChecker, classDeclaration: ClassLikeDeclaration, token: Node) {
        let typeNode: TypeNode;
        if (token.parent.parent.kind === SyntaxKind.BinaryExpression) {
            const binaryExpression = token.parent.parent as BinaryExpression;
            const otherExpression = token.parent === binaryExpression.left ? binaryExpression.right : binaryExpression.left;
            const widenedType = checker.getWidenedType(checker.getBaseTypeOfLiteralType(checker.getTypeAtLocation(otherExpression)));
            typeNode = checker.typeToTypeNode(widenedType, classDeclaration);
        }
        return typeNode || createKeywordTypeNode(SyntaxKind.AnyKeyword);
    }

    function createAddPropertyDeclarationAction(context: CodeFixContext, classDeclarationSourceFile: SourceFile, classOpenBrace: Node, makeStatic: boolean, tokenName: string, typeNode: TypeNode): CodeAction {
        const description = formatStringFromArgs(getLocaleSpecificMessage(makeStatic ? Diagnostics.Declare_static_property_0 : Diagnostics.Declare_property_0), [tokenName]);
        const changes = textChanges.ChangeTracker.with(context, t => addPropertyDeclaration(t, classDeclarationSourceFile, classOpenBrace, tokenName, typeNode, makeStatic, context.newLineCharacter));
        return { description, changes, groupId };
    }

    function addPropertyDeclaration(changeTracker: textChanges.ChangeTracker, classDeclarationSourceFile: SourceFile, classOpenBrace: Node, tokenName: string, typeNode: TypeNode, makeStatic: boolean, newLineCharacter: string): void {//name
        const property = createProperty(
            /*decorators*/ undefined,
            /*modifiers*/ makeStatic ? [createToken(SyntaxKind.StaticKeyword)] : undefined,
            tokenName,
            /*questionToken*/ undefined,
            typeNode,
            /*initializer*/ undefined);
        changeTracker.insertNodeAfter(classDeclarationSourceFile, classOpenBrace, property, { suffix: newLineCharacter })
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

    function getActionForMethodDeclaration(context: CodeFixContext, classDeclarationSourceFile: SourceFile, classOpenBrace: Node, token: Identifier, callExpression: CallExpression, makeStatic: boolean, inJs: boolean): CodeAction | undefined {
        const description = formatStringFromArgs(getLocaleSpecificMessage(makeStatic ? Diagnostics.Declare_static_method_0 : Diagnostics.Declare_method_0), [token.text]);
        const changes = textChanges.ChangeTracker.with(context, t => addMethodDeclaration(t, classDeclarationSourceFile, classOpenBrace, token, callExpression, context.newLineCharacter, makeStatic, inJs));
        return { description, changes, groupId };
    }

    function addMethodDeclaration(changeTracker: textChanges.ChangeTracker, classDeclarationSourceFile: SourceFile, classOpenBrace: Node, token: Identifier, callExpression: CallExpression, newLineCharacter: string, makeStatic: boolean, inJs: boolean) {
        const methodDeclaration = createMethodFromCallExpression(callExpression, token.text, inJs, makeStatic);
        changeTracker.insertNodeAfter(classDeclarationSourceFile, classOpenBrace, methodDeclaration, { suffix: newLineCharacter });
    }
}
