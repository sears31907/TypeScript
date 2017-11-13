/* @internal */
namespace ts.codefix {
    const ignoreGroupId = "ignore";

    registerCodeFix({
        errorCodes: getApplicableDiagnosticCodes(),
        getCodeActions: getDisableJsDiagnosticsCodeActions,
        groupIds: [ignoreGroupId], // No point applying as a group, doing it once will fix all errors
        fixAllInGroup,
    });

    function getApplicableDiagnosticCodes(): number[] {
        const allDiagnostcs = <MapLike<DiagnosticMessage>>Diagnostics;
        return Object.keys(allDiagnostcs)
            .filter(d => allDiagnostcs[d] && allDiagnostcs[d].category === DiagnosticCategory.Error)
            .map(d => allDiagnostcs[d].code);
    }

    function getIgnoreCommentLocationForLocation(sourceFile: SourceFile, position: number, newLineCharacter: string): TextChange {
        const { line } = getLineAndCharacterOfPosition(sourceFile, position);
        const lineStartPosition = getStartPositionOfLine(line, sourceFile);
        const startPosition = getFirstNonSpaceCharacterPosition(sourceFile.text, lineStartPosition);

        // First try to see if we can put the '// @ts-ignore' on the previous line.
        // We need to make sure that we are not in the middle of a string literal or a comment.
        // We also want to check if the previous line holds a comment for a node on the next line
        // if so, we do not want to separate the node from its comment if we can.
        if (!isInComment(sourceFile, startPosition) && !isInString(sourceFile, startPosition) && !isInTemplateString(sourceFile, startPosition)) {
            const token = getTouchingToken(sourceFile, startPosition, /*includeJsDocComment*/ false);
            const tokenLeadingCommnets = getLeadingCommentRangesOfNode(token, sourceFile);
            if (!tokenLeadingCommnets || !tokenLeadingCommnets.length || tokenLeadingCommnets[0].pos >= startPosition) {
                return {
                    span: { start: startPosition, length: 0 },
                    newText: `// @ts-ignore${newLineCharacter}`
                };
            }
        }

        // If all fails, add an extra new line immediately before the error span.
        return {
            span: { start: position, length: 0 },
            newText: `${position === startPosition ? "" : newLineCharacter}// @ts-ignore${newLineCharacter}`
        };
    }

    function getDisableJsDiagnosticsCodeActions(context: CodeFixContext): CodeAction[] | undefined {
        const { sourceFile, program, newLineCharacter, span } = context;

        if (!isInJavaScriptFile(sourceFile) || !isCheckJsEnabledForFile(sourceFile, program.getCompilerOptions())) {
            return undefined;
        }

        return [{
            description: getLocaleSpecificMessage(Diagnostics.Ignore_this_error_message),
            changes: [createFileTextChanges(sourceFile.fileName, [getIgnoreCommentLocationForLocation(sourceFile, span.start, newLineCharacter)])],
            groupId: ignoreGroupId,
        },
        {
            description: getLocaleSpecificMessage(Diagnostics.Disable_checking_for_this_file),
            changes: [createFileTextChanges(sourceFile.fileName, [{
                span: {
                    start: sourceFile.checkJsDirective ? sourceFile.checkJsDirective.pos : 0,
                    length: sourceFile.checkJsDirective ? sourceFile.checkJsDirective.end - sourceFile.checkJsDirective.pos : 0
                },
                newText: `// @ts-nocheck${newLineCharacter}`
            }])]
        }];
    }

    function fixAllInGroup(context: CodeFixAllContext): CodeActionAll {
        const { groupId, newLineCharacter, program, sourceFile } = context;
        Debug.assertEqual(groupId, ignoreGroupId);
        const errors = program.getSemanticDiagnostics(); //todo: get other diagnostics?
        const changes = sortTextChanges(mapDefined(errors, error =>
            error.start === undefined || error.length === undefined ? undefined : getIgnoreCommentLocationForLocation(sourceFile, error.start, newLineCharacter)));
        return createCodeActionAll([createFileTextChanges(sourceFile.fileName, changes)]);
    }
}
